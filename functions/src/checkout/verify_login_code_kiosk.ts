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
 * the kiosk has no sign-up flow, so a completed account (users doc with
 * accepted terms) is required.
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

  // Same "completed account" semantics as checkAccountExists: a users doc
  // with accepted terms. A bare Auth user from an abandoned sign-up does
  // not count and must finish registration on their own device.
  const db = getFirestore();
  const snap = await db
    .collection("users")
    .where("email", "==", normalizeEmail(email))
    .limit(1)
    .get();
  const userDoc = snap.empty ? null : snap.docs[0];
  if (!userDoc || userDoc.get("termsAcceptedAt") == null) {
    logger.warn("verifyLoginCodeKiosk: no completed account", { email });
    throw new HttpsError(
      "failed-precondition",
      "Kein abgeschlossenes Konto für diese E-Mail. Bitte registriere dich zuerst auf deinem eigenen Gerät."
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
