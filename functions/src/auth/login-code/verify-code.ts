// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * verifyLoginCode — consumes a 6-digit code and returns a Firebase custom
 * token. Caps at 5 attempts per doc; the 6th attempt burns the doc.
 */

import {
  HttpsError,
  onCall,
  type CallableRequest,
} from "firebase-functions/v2/https";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import {
  constantTimeEqual,
  hashCode,
  mintSessionToken,
  normalizeEmail,
} from "./helpers";

const MAX_ATTEMPTS = 5;

export interface VerifyLoginCodeInput {
  email: string;
  code: string;
}

export interface VerifyLoginCodeResult {
  customToken: string;
}

export async function handleVerifyLoginCode(
  input: VerifyLoginCodeInput
): Promise<VerifyLoginCodeResult> {
  if (!input?.email || !input?.code) {
    throw new HttpsError("invalid-argument", "email and code are required");
  }
  const email = normalizeEmail(input.email);
  if (!/^\d{6}$/.test(input.code)) {
    throw new HttpsError("invalid-argument", "invalid code format");
  }

  const db = getFirestore();
  const snap = await db
    .collection("loginCodes")
    .where("email", "==", email)
    .orderBy("created", "desc")
    .limit(1)
    .get();

  if (snap.empty) {
    throw new HttpsError("failed-precondition", "Kein aktiver Anmeldecode.");
  }

  const docRef = snap.docs[0].ref;

  type Outcome =
    | { kind: "ok"; email: string }
    | { kind: "consumed" }
    | { kind: "expired" }
    | { kind: "locked" }
    | { kind: "wrong" };

  // Decide + commit the side-effect atomically. Throwing from inside the
  // transaction would roll back the attempts update, so we encode the
  // outcome as a return value and throw outside.
  const outcome = await db.runTransaction<Outcome>(async (tx) => {
    const doc = await tx.get(docRef);
    const data = doc.data();
    if (!data) return { kind: "consumed" };

    if (data.consumedAt) return { kind: "consumed" };
    if ((data.expiresAt as Timestamp).toMillis() < Date.now()) {
      return { kind: "expired" };
    }

    const newAttempts = (data.attempts ?? 0) + 1;
    if (newAttempts > MAX_ATTEMPTS) {
      tx.update(docRef, { consumedAt: Timestamp.now() });
      return { kind: "locked" };
    }

    const providedHash = hashCode(input.code, doc.id);
    const expectedHash = data.codeHash as string;
    if (!constantTimeEqual(providedHash, expectedHash)) {
      tx.update(docRef, { attempts: newAttempts });
      return { kind: "wrong" };
    }

    tx.update(docRef, {
      consumedAt: Timestamp.now(),
      attempts: newAttempts,
    });
    return { kind: "ok", email: data.email as string };
  });

  switch (outcome.kind) {
    case "consumed":
      throw new HttpsError("failed-precondition", "Code bereits verwendet.");
    case "expired":
      throw new HttpsError("failed-precondition", "Code abgelaufen.");
    case "locked":
      throw new HttpsError("failed-precondition", "Zu viele Versuche.");
    case "wrong":
      throw new HttpsError("failed-precondition", "Code falsch.");
    case "ok": {
      const customToken = await mintSessionToken(outcome.email, "emailCode");
      return { customToken };
    }
  }
}

export const verifyLoginCode = onCall(
  async (request: CallableRequest<VerifyLoginCodeInput>) =>
    handleVerifyLoginCode(request.data)
);
