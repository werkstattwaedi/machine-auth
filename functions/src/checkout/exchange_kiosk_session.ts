// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * exchangeKioskSession — swap a just-established PHONE sign-in for the
 * lightweight synthetic `actsAs` kiosk session (ADR-0022 / ADR-0031).
 *
 * Firebase phone auth verifies the SMS code client-side, which necessarily
 * signs the kiosk browser in as the REAL user — exactly what the kiosk
 * session model forbids (persistent principal on a shared terminal). The
 * kiosk therefore calls this immediately after `confirm(code)`: the caller's
 * identity is proven by `request.auth`, we mint the same ephemeral kiosk
 * token a badge tap or email code would, and the client replaces its session
 * with it (establishKioskSession signs the phone session out).
 *
 * Deliberately narrow: only a `phone`-provider principal may exchange. A
 * persistent email/Google session on the kiosk is a configuration error we
 * don't want to legitimize, and anonymous/tag principals have no business
 * here at all.
 */

import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import {
  assertKioskBearer,
  buildKioskUserPayload,
  mintKioskSessionToken,
  type KioskUserPayload,
} from "./kiosk_session";

export interface ExchangeKioskSessionInput {
  bearer?: string;
}

export interface ExchangeKioskSessionResult extends KioskUserPayload {
  customToken: string;
}

export async function handleExchangeKioskSession(
  request: CallableRequest<ExchangeKioskSessionInput>
): Promise<ExchangeKioskSessionResult> {
  assertKioskBearer(request.data?.bearer, "exchangeKioskSession");

  const auth = request.auth;
  if (!auth) {
    throw new HttpsError("unauthenticated", "Sign in first");
  }
  const provider = auth.token.firebase?.sign_in_provider;
  if (provider !== "phone" || auth.token.tagCheckout) {
    logger.warn(
      `exchangeKioskSession rejected: provider=${provider} uid=${auth.uid}`
    );
    throw new HttpsError(
      "failed-precondition",
      "Only a phone sign-in can be exchanged for a kiosk session"
    );
  }

  const userDoc = await getFirestore().collection("users").doc(auth.uid).get();
  if (!userDoc.exists || userDoc.get("termsAcceptedAt") == null) {
    // Mirrors verifyLoginCodeKiosk: no kiosk sign-up — a bare Auth user
    // without a completed profile registers on their own device.
    throw new HttpsError(
      "failed-precondition",
      "Für diese Handynummer existiert noch kein vollständiges Konto. Bitte registriere dich zuerst auf deinem eigenen Gerät."
    );
  }

  const customToken = await mintKioskSessionToken(auth.uid, "smsCode");
  return { customToken, ...buildKioskUserPayload(auth.uid, userDoc.data()) };
}

export const exchangeKioskSessionHandler = async (
  request: CallableRequest<ExchangeKioskSessionInput>
) => handleExchangeKioskSession(request);
