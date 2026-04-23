// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * verifyMagicLink — consumes a magic-link token (== loginCodes doc ID)
 * and returns a Firebase custom token.
 */

import {
  HttpsError,
  onCall,
  type CallableRequest,
} from "firebase-functions/v2/https";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { mintSessionToken } from "./helpers";

export interface VerifyMagicLinkInput {
  token: string;
}

export interface VerifyMagicLinkResult {
  customToken: string;
}

export async function handleVerifyMagicLink(
  input: VerifyMagicLinkInput
): Promise<VerifyMagicLinkResult> {
  if (!input?.token || typeof input.token !== "string") {
    throw new HttpsError("invalid-argument", "token required");
  }
  // base64url shape check — stops obvious garbage / injection attempts early.
  if (!/^[A-Za-z0-9_-]{16,}$/.test(input.token)) {
    throw new HttpsError("invalid-argument", "invalid token");
  }

  const db = getFirestore();
  const docRef = db.collection("loginCodes").doc(input.token);

  // Throwing from inside the transaction is safe *here* because every throw
  // branch runs before any write — nothing gets rolled back. verify-code.ts
  // uses a sentinel pattern because it does write-then-decide (incrementing
  // the attempts counter) and throwing there would undo the increment.
  const verifiedEmail = await db.runTransaction<string>(async (tx) => {
    const doc = await tx.get(docRef);
    if (!doc.exists) {
      throw new HttpsError("failed-precondition", "Link ungültig.");
    }
    const data = doc.data()!;
    if (data.consumedAt) {
      throw new HttpsError("failed-precondition", "Link bereits verwendet.");
    }
    if ((data.expiresAt as Timestamp).toMillis() < Date.now()) {
      throw new HttpsError("failed-precondition", "Link abgelaufen.");
    }
    tx.update(docRef, { consumedAt: Timestamp.now() });
    return data.email as string;
  });

  const customToken = await mintSessionToken(verifiedEmail, "magicLink");
  return { customToken };
}

export const verifyMagicLink = onCall(
  async (request: CallableRequest<VerifyMagicLinkInput>) =>
    handleVerifyMagicLink(request.data)
);
