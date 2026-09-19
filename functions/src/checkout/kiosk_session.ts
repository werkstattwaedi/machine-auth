// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * @fileoverview Shared kiosk-session primitives (ADR-0022).
 *
 * A kiosk session is a Firebase principal with a SYNTHETIC uid acting on
 * behalf of a real user via the `actsAs` claim. Two mint paths share this
 * module: the SDM badge tap (verify_tag.ts) and the email login code
 * (verify_login_code_kiosk.ts). Both are gated on the kiosk bearer so only
 * the kiosk Electron bridge can create actsAs principals.
 */

import * as crypto from "crypto";
import { getAuth } from "firebase-admin/auth";
import * as logger from "firebase-functions/logger";
import {
  HttpsError,
  type CallableRequest,
} from "firebase-functions/v2/https";
import { defineString } from "firebase-functions/params";
import { kioskBearer } from "../config/tag-secrets";
import { parseIntParamOrDie } from "../auth/login-code/helpers";

/**
 * How long an OTP-elevated kiosk session may reach the member area
 * (ADR-0041). Fixed, server-enforced, no silent renewal — extending it means
 * entering a new code. Tunable from the operations config like the
 * login-code caps (issue #152).
 */
const DEFAULT_KIOSK_ELEVATION_TTL_MS = 15 * 60 * 1000;
const kioskElevationTtlMsParam = defineString("KIOSK_ELEVATION_TTL_MS", {
  default: String(DEFAULT_KIOSK_ELEVATION_TTL_MS),
});

export function kioskElevationTtlMs(): number {
  // generate-env emits `KIOSK_ELEVATION_TTL_MS=` (empty) when the operations
  // config has no key; empty means "use the default", not "misconfigured".
  const raw = kioskElevationTtlMsParam.value().trim();
  if (raw === "") return DEFAULT_KIOSK_ELEVATION_TTL_MS;
  return parseIntParamOrDie("KIOSK_ELEVATION_TTL_MS", raw);
}

/** How the kiosk session was established — audit/telemetry only.
 *  "signup" = the account was created in the same call (signupKiosk). */
export type KioskSessionMethod = "tag" | "emailCode" | "smsCode" | "signup";

/**
 * User fields the kiosk client may see for pre-fill. `activeMembership` is
 * collapsed to a boolean (the stored field is a `DocumentReference | null`)
 * so nothing membership-internal leaks to the kiosk client (issue #358).
 */
export interface KioskUserPayload {
  userId: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  userType?: string;
  activeMembership: boolean;
  /**
   * Epoch ms until which the minted session is elevated (ADR-0041), or
   * `null` for a plain checkout-only session. Mirrors the `elevatedUntil`
   * token claim so the client needn't decode the token.
   */
  elevatedUntil: number | null;
}

/**
 * Soft revocation/audit gate for kiosk-only callables. The kiosk Electron
 * bridge supplies the bearer; the real security is the SDM tag crypto or the
 * consumed login code plus the synthetic-uid custom token. Skipped in the
 * emulator so E2E needs no secret in seed data.
 *
 * @throws HttpsError permission-denied when the bearer is missing/invalid.
 */
export function assertKioskBearer(
  bearer: string | undefined,
  callableName: string
): void {
  if (process.env.FUNCTIONS_EMULATOR === "true") return;
  const expected = kioskBearer();
  // An unset/blank secret must refuse everyone, not accept an empty bearer.
  if (expected === "" || bearer !== expected) {
    logger.warn(`${callableName} rejected: missing/invalid kiosk bearer.`);
    throw new HttpsError("permission-denied", "Forbidden");
  }
}

/**
 * The acting user of an ESTABLISHED kiosk session, or throws. For callables
 * whose credential is the session itself (issue #595): the `actsAs` claim is
 * set exclusively by the bearer-gated mint paths below, so requiring it
 * binds the call to exactly one user with no client-supplied id to trust.
 */
export function requireActsAs(request: CallableRequest<unknown>): string {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Nicht angemeldet.");
  }
  const claims = request.auth.token as {
    tagCheckout?: unknown;
    actsAs?: unknown;
  };
  if (
    claims.tagCheckout !== true ||
    typeof claims.actsAs !== "string" ||
    claims.actsAs.length === 0
  ) {
    throw new HttpsError("permission-denied", "Forbidden");
  }
  return claims.actsAs;
}

/**
 * Elevation claim of a kiosk session, if any (ADR-0041). Shared shape for
 * callables and the membership caller resolution.
 */
export function elevatedUntilFromClaims(
  claims: Record<string, unknown> | undefined
): number | null {
  const v = claims?.["elevatedUntil"];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** True when `claims` carry an unexpired `elevatedUntil` (ADR-0041). */
export function isElevatedNow(
  claims: Record<string, unknown> | undefined,
  now: number = Date.now()
): boolean {
  const until = elevatedUntilFromClaims(claims);
  return until !== null && until > now;
}

/**
 * The acting user of an ELEVATED kiosk session, or throws (ADR-0041). Same
 * binding as `requireActsAs`, plus the OTP-proof claim must not have
 * expired. Member-area callables that a kiosk session may reach gate on
 * this — never on `request.auth.uid`, which is synthetic for tag sessions.
 */
export function requireElevatedActsAs(
  request: CallableRequest<unknown>
): string {
  const actsAs = requireActsAs(request);
  if (!isElevatedNow(request.auth?.token as Record<string, unknown>)) {
    throw new HttpsError(
      "permission-denied",
      "Bitte bestätige dich erneut mit einem Code."
    );
  }
  return actsAs;
}

export interface MintKioskSessionOptions {
  /**
   * Stamp `elevatedUntil = now + KIOSK_ELEVATION_TTL_MS` (ADR-0041). Set by
   * the mint paths that just verified an OTP (e-mail code, SMS code,
   * sign-up) and by the step-up re-mint; NEVER by the badge tap.
   */
  elevated?: boolean;
  /**
   * Re-use an existing session uid instead of drawing a fresh nonce — the
   * step-up re-mints the caller's own session so the open checkout,
   * `modifiedBy` and the client's session store stay valid. Must be a
   * `tag:<realUserId>:` uid for the same user.
   */
  sessionUid?: string;
}

/**
 * Creates a Firebase custom token with a SYNTHETIC UID so the kiosk session
 * is a different Firebase principal than the real user. This is the actual
 * security defense:
 *  - createCustomToken merges developer claims with the auth user's
 *    persistent custom claims. If we used realUserId, an admin signing in
 *    at the kiosk would get an `admin: true` session.
 *  - With a synthetic UID, no persistent claims exist, so the kiosk
 *    session has only the claims we explicitly set here.
 * The `actsAs` claim names the real user; rules and callables use it for
 * owner checks instead of `request.auth.uid`. The `tag:` uid prefix and
 * `tagCheckout` claim are kept for BOTH mint methods so existing rules and
 * sessionKind derivation work unchanged; `method` records how the session
 * was established.
 */
export async function mintKioskSessionToken(
  realUserId: string,
  method: KioskSessionMethod,
  options: MintKioskSessionOptions = {}
): Promise<{ customToken: string; elevatedUntil: number | null }> {
  const prefix = `tag:${realUserId}:`;
  if (options.sessionUid !== undefined && !options.sessionUid.startsWith(prefix)) {
    // Defensive: a re-mint must never change who the session acts as.
    throw new HttpsError("permission-denied", "Forbidden");
  }
  const sessionUid =
    options.sessionUid ??
    `${prefix}${crypto.randomBytes(12).toString("base64url")}`;
  const elevatedUntil = options.elevated
    ? Date.now() + kioskElevationTtlMs()
    : null;
  const customToken = await getAuth().createCustomToken(sessionUid, {
    tagCheckout: true,
    actsAs: realUserId,
    kioskId: "kiosk-1",
    method,
    ...(elevatedUntil !== null ? { elevatedUntil } : {}),
  });
  return { customToken, elevatedUntil };
}

/** Pre-fill payload from a `users/{userId}` doc snapshot's data. */
export function buildKioskUserPayload(
  userId: string,
  userData: FirebaseFirestore.DocumentData | undefined,
  elevatedUntil: number | null = null
): KioskUserPayload {
  return {
    userId,
    firstName: userData?.firstName,
    lastName: userData?.lastName,
    email: userData?.email,
    userType: userData?.userType,
    activeMembership: !!userData?.activeMembership,
    elevatedUntil,
  };
}
