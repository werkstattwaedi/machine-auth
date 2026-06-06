// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Callable handler: resolve a tapped NFC tag for an admin.
 *
 * The admin web app reads a tag's SUN URL via Web NFC (Chrome/Android) and
 * sends the `picc`/`cmac` parameters here. Because the tags use Random-ID, the
 * real UID — and therefore the canonical `tokens/{id}` document id — is only
 * recoverable by decrypting the PICC ciphertext server-side. This callable does
 * that decryption + CMAC authentication under an admin session and reports
 * whether the tag is already registered.
 *
 * Unlike the kiosk `verifyTagCheckout` endpoint, this is a pure read: it does
 * NOT advance the SDM replay counter and does NOT mint a session token. It
 * works for unregistered tags (the shared core authenticates via the
 * UID-diversified key, independent of any token doc).
 */

import * as logger from "firebase-functions/logger";
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { decryptAndVerifyTag } from "../checkout/verify_tag";
import { formatFullName } from "../util/username-utils";
import {
  terminalKey,
  diversificationMasterKey,
  diversificationSystemName,
} from "../config/tag-secrets";

interface ResolveTagData {
  picc?: string;
  cmac?: string;
}

export interface ResolveTagResponse {
  tokenId: string;
  registered: boolean;
  deactivated: boolean;
  userId?: string;
  userName?: string;
}

export const resolveTagHandler = async (
  request: CallableRequest<unknown>
): Promise<ResolveTagResponse> => {
  // Require admin custom claim (kept in sync from users/{uid}.roles).
  if (!request.auth?.token?.admin) {
    throw new HttpsError("permission-denied", "Admin access required");
  }

  const { picc, cmac } = (request.data ?? {}) as ResolveTagData;
  if (!picc || !cmac) {
    throw new HttpsError("invalid-argument", "picc und cmac sind erforderlich");
  }

  // Decrypt + authenticate. Any failure (bad ciphertext, forged/cloned UID,
  // wrong CMAC) collapses to one opaque error — don't leak which check failed.
  let tokenId: string;
  try {
    ({ tokenId } = decryptAndVerifyTag(
      { picc, cmac },
      {
        terminalKey: terminalKey.value(),
        masterKey: diversificationMasterKey.value(),
        systemName: diversificationSystemName.value(),
      }
    ));
  } catch (error: any) {
    logger.warn("resolveTag: tag authentication failed", {
      error: error?.message,
    });
    throw new HttpsError("invalid-argument", "Ungültiger Tag");
  }

  // Look up the token; it may not exist yet (a fresh, unregistered tag).
  const db = getFirestore();
  const tokenDoc = await db.collection("tokens").doc(tokenId).get();

  if (!tokenDoc.exists) {
    return { tokenId, registered: false, deactivated: false };
  }

  const tokenData = tokenDoc.data()!;
  const userRef = tokenData.userId;
  const response: ResolveTagResponse = {
    tokenId,
    registered: true,
    deactivated: !!tokenData.deactivated,
  };

  if (userRef?.id) {
    response.userId = userRef.id;
    const userDoc = await userRef.get();
    if (userDoc.exists) {
      const name = formatFullName(userDoc.data() ?? {});
      if (name) response.userName = name;
    }
  }

  return response;
};
