// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * @fileoverview verifyLoginCodeKiosk — email-code sign-in at the checkout
 * kiosk (ADR-0022).
 *
 * Consumes a 6-digit login code like `verifyLoginCode`, but instead of a
 * real persistent session it mints the same lightweight synthetic-uid
 * `actsAs` session a badge tap produces. Kiosk-bearer-gated so phones
 * cannot mint actsAs principals (a phone holding a valid code could always
 * mint a strictly more powerful real session via `verifyLoginCode`, so no
 * escalation exists — the gate keeps actsAs minting kiosk-only).
 *
 * Unlike `mintSessionToken` this NEVER auto-creates a Firebase Auth user:
 * a `users` doc is required. Truly new e-mails go through `signupKiosk`
 * instead (issue #595). An unclaimed/imported member (doc without accepted
 * terms) DOES get a session — the wizard then runs the kiosk welcome
 * onboarding, whose writes go through `completeOnboardingKiosk`.
 */

import { getFirestore } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import {
  HttpsError,
  type CallableRequest,
} from "firebase-functions/v2/https";
import {
  consumeLoginCode,
  type VerifyLoginCodeInput,
} from "../auth/login-code/verify-code";
import { normalizeEmail } from "../auth/login-code/helpers";
import {
  assertKioskBearer,
  buildKioskUserPayload,
  mintKioskSessionToken,
  type KioskUserPayload,
} from "./kiosk_session";

export interface VerifyLoginCodeKioskResult extends KioskUserPayload {
  customToken: string;
}

export async function handleVerifyLoginCodeKiosk(
  input: VerifyLoginCodeInput
): Promise<VerifyLoginCodeKioskResult> {
  const { email } = await consumeLoginCode(input);

  // A `users` doc is required (same as checkAccountExists' hasProfile) — a
  // bare Auth user from an abandoned sign-up does not count. Terms are NOT
  // required here (issue #595): an unclaimed member signs in and the kiosk
  // welcome onboarding collects them; a badge tap never checked terms
  // either, so this adds no new authority.
  const db = getFirestore();
  const snap = await db
    .collection("users")
    .where("email", "==", normalizeEmail(email))
    .limit(1)
    .get();
  const userDoc = snap.empty ? null : snap.docs[0];
  if (!userDoc) {
    logger.warn("verifyLoginCodeKiosk: no account", { email });
    throw new HttpsError(
      "failed-precondition",
      "Kein Konto für diese E-Mail. Bitte erstelle zuerst ein Konto."
    );
  }

  const customToken = await mintKioskSessionToken(userDoc.id, "emailCode");
  return {
    customToken,
    ...buildKioskUserPayload(userDoc.id, userDoc.data()),
  };
}

export const verifyLoginCodeKioskHandler = async (
  request: CallableRequest<VerifyLoginCodeInput & { bearer?: string }>
): Promise<VerifyLoginCodeKioskResult> => {
  const { email, code, bearer } = request.data ?? ({} as VerifyLoginCodeInput);
  assertKioskBearer(bearer, "verifyLoginCodeKiosk");
  return handleVerifyLoginCodeKiosk({ email, code });
};
