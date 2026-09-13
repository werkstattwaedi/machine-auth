// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * @fileoverview Kiosk step-up (ADR-0041): elevate an existing `actsAs`
 * session so it may reach the member area.
 *
 * A badge tap mints a checkout-only session (no `elevatedUntil` claim). To
 * manage the account at the kiosk the visitor proves possession of a
 * second factor bound to the account's OWN contact address:
 *
 *  - e-mail: `requestKioskElevation` sends a normal login code to the
 *    e-mail STORED on the user doc (the client never supplies an address, so
 *    a badge holder cannot redirect the code); `verifyKioskElevation`
 *    consumes it and re-mints the SAME session uid with `elevatedUntil`.
 *  - SMS: client-driven via Firebase phone auth against the Auth-linked
 *    number returned by `getKioskElevationOptions`; the confirm lands in
 *    the existing `exchangeKioskSession` (see there).
 *
 * All three are kiosk-bearer-gated and require an established `actsAs`
 * session — the session itself is the credential naming the user.
 */

import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import {
  HttpsError,
  type CallableRequest,
} from "firebase-functions/v2/https";
import { handleRequestLoginCode } from "../auth/login-code/request";
import { consumeLoginCode } from "../auth/login-code/verify-code";
import { normalizeEmail } from "../auth/login-code/helpers";
import {
  assertKioskBearer,
  buildKioskUserPayload,
  mintKioskSessionToken,
  requireActsAs,
  type KioskSessionMethod,
  type KioskUserPayload,
} from "./kiosk_session";

export interface KioskElevationOptions {
  /** `null` when the account has no usable e-mail (should not happen). */
  email: { masked: string } | null;
  /**
   * Present when the Auth user has a linked (verified) phone number. The
   * full E.164 number is needed because Firebase phone auth is
   * client-driven; the `actsAs` session can already read the user doc, so
   * this discloses nothing new. Render `masked` only.
   */
  sms: { masked: string; phoneNumber: string } | null;
}

/** `michschn@gmail.com` → `mi•••@gm•••.com` */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "•••";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const lastDot = domain.lastIndexOf(".");
  const host = lastDot > 0 ? domain.slice(0, lastDot) : domain;
  const tld = lastDot > 0 ? domain.slice(lastDot) : "";
  return `${local.slice(0, 2)}•••@${host.slice(0, 2)}•••${tld}`;
}

/** `+41791234528` → `+41 79 ••• •• 28` (last two digits kept). */
export function maskPhone(e164: string): string {
  const digits = e164.replace(/[^\d]/g, "");
  if (digits.length < 6) return "•••";
  const country = e164.startsWith("+") ? `+${digits.slice(0, 2)}` : digits.slice(0, 2);
  const rest = digits.slice(2);
  const prefix = rest.slice(0, 2);
  const tail = rest.slice(-2);
  return `${country} ${prefix} ••• •• ${tail}`;
}

async function loadActingUser(actsAs: string) {
  const snap = await getFirestore().collection("users").doc(actsAs).get();
  if (!snap.exists) {
    // A session for a deleted user — nothing to elevate.
    throw new HttpsError("failed-precondition", "Konto nicht gefunden.");
  }
  const email = snap.get("email");
  return {
    snap,
    email:
      typeof email === "string" && email.length > 0
        ? normalizeEmail(email)
        : null,
  };
}

async function linkedPhoneNumber(actsAs: string): Promise<string | null> {
  try {
    const user = await getAuth().getUser(actsAs);
    return user.phoneNumber ?? null;
  } catch {
    // No Auth user (imported member who never signed in) → no SMS option.
    return null;
  }
}

// --- getKioskElevationOptions ------------------------------------------------

export async function handleGetKioskElevationOptions(
  request: CallableRequest<{ bearer?: string }>
): Promise<KioskElevationOptions> {
  assertKioskBearer(request.data?.bearer, "getKioskElevationOptions");
  const actsAs = requireActsAs(request);
  const [{ email }, phoneNumber] = await Promise.all([
    loadActingUser(actsAs),
    linkedPhoneNumber(actsAs),
  ]);
  return {
    email: email ? { masked: maskEmail(email) } : null,
    sms: phoneNumber
      ? { masked: maskPhone(phoneNumber), phoneNumber }
      : null,
  };
}

export const getKioskElevationOptionsHandler = handleGetKioskElevationOptions;

// --- requestKioskElevation ---------------------------------------------------

export interface RequestKioskElevationResult {
  masked: string;
}

export async function handleRequestKioskElevation(
  request: CallableRequest<{ bearer?: string }>,
  requestOrigin: string | undefined | null
): Promise<RequestKioskElevationResult> {
  assertKioskBearer(request.data?.bearer, "requestKioskElevation");
  const actsAs = requireActsAs(request);
  const { email } = await loadActingUser(actsAs);
  if (!email) {
    throw new HttpsError(
      "failed-precondition",
      "Für dieses Konto ist keine E-Mail hinterlegt."
    );
  }
  // Same code, same delivery, same limits as a regular sign-in (60 s
  // throttle, 24 h caps, 5-attempt lock) — only the address is server-chosen.
  await handleRequestLoginCode({ email }, requestOrigin);
  logger.info("requestKioskElevation: code sent", { userId: actsAs });
  return { masked: maskEmail(email) };
}

export const requestKioskElevationHandler = async (
  request: CallableRequest<{ bearer?: string }>
) => {
  const origin =
    (request.rawRequest?.headers?.origin as string | undefined) ?? null;
  return handleRequestKioskElevation(request, origin);
};

// --- verifyKioskElevation ----------------------------------------------------

export interface VerifyKioskElevationInput {
  bearer?: string;
  code: string;
}

export interface VerifyKioskElevationResult extends KioskUserPayload {
  customToken: string;
}

export async function handleVerifyKioskElevation(
  request: CallableRequest<VerifyKioskElevationInput>
): Promise<VerifyKioskElevationResult> {
  assertKioskBearer(request.data?.bearer, "verifyKioskElevation");
  const actsAs = requireActsAs(request);
  const { snap, email } = await loadActingUser(actsAs);
  if (!email) {
    throw new HttpsError(
      "failed-precondition",
      "Für dieses Konto ist keine E-Mail hinterlegt."
    );
  }
  await consumeLoginCode({ email, code: request.data?.code });

  // Re-mint the caller's OWN session uid: the open checkout, `modifiedBy`
  // and the client's kiosk session store keep working; only the claim set
  // changes. `method` is carried over for audit continuity.
  const claims = request.auth!.token as { method?: unknown };
  const method: KioskSessionMethod =
    claims.method === "emailCode" ||
    claims.method === "smsCode" ||
    claims.method === "signup"
      ? claims.method
      : "tag";
  const { customToken, elevatedUntil } = await mintKioskSessionToken(
    actsAs,
    method,
    { elevated: true, sessionUid: request.auth!.uid }
  );
  logger.info("verifyKioskElevation: session elevated", {
    userId: actsAs,
    elevatedUntil,
  });
  return {
    customToken,
    ...buildKioskUserPayload(actsAs, snap.data(), elevatedUntil),
  };
}

export const verifyKioskElevationHandler = handleVerifyKioskElevation;
