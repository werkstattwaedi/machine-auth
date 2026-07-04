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
import { HttpsError } from "firebase-functions/v2/https";
import { kioskBearerKey } from "../config/tag-secrets";

/** How the kiosk session was established — audit/telemetry only. */
export type KioskSessionMethod = "tag" | "emailCode" | "smsCode";

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
  if (
    process.env.FUNCTIONS_EMULATOR !== "true" &&
    bearer !== kioskBearerKey.value()
  ) {
    logger.warn(`${callableName} rejected: missing/invalid kiosk bearer.`);
    throw new HttpsError("permission-denied", "Forbidden");
  }
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
  method: KioskSessionMethod
): Promise<string> {
  const sessionUid = `tag:${realUserId}:${crypto
    .randomBytes(12)
    .toString("base64url")}`;
  return getAuth().createCustomToken(sessionUid, {
    tagCheckout: true,
    actsAs: realUserId,
    kioskId: "kiosk-1",
    method,
  });
}

/** Pre-fill payload from a `users/{userId}` doc snapshot's data. */
export function buildKioskUserPayload(
  userId: string,
  userData: FirebaseFirestore.DocumentData | undefined
): KioskUserPayload {
  return {
    userId,
    firstName: userData?.firstName,
    lastName: userData?.lastName,
    email: userData?.email,
    userType: userData?.userType,
    activeMembership: !!userData?.activeMembership,
  };
}
