// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import * as logger from "firebase-functions/logger";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import type { BillEntity } from "./types";

export const getInvoiceDownloadUrl = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required");
  }

  const { billId } = request.data as { billId: string };
  if (!billId || typeof billId !== "string") {
    throw new HttpsError("invalid-argument", "billId is required");
  }

  const db = getFirestore();
  const billSnap = await db.doc(`bills/${billId}`).get();
  if (!billSnap.exists) {
    throw new HttpsError("not-found", "Bill not found");
  }

  const bill = billSnap.data() as BillEntity;
  const isAdmin = request.auth.token.admin === true;
  // users/{userId} doc IDs equal Firebase Auth UIDs (see schema.jsonc), so
  // comparing the doc ID to request.auth.uid is equivalent to reference equality.
  const isOwner = bill.userId.id === request.auth.uid;

  if (!isAdmin && !isOwner) {
    throw new HttpsError("permission-denied", "Access denied");
  }

  if (!bill.storagePath) {
    throw new HttpsError("failed-precondition", "PDF not yet generated");
  }

  const file = getStorage().bucket().file(bill.storagePath);
  const [url] = await file.getSignedUrl({
    action: "read",
    expires: Date.now() + 3600 * 1000,
  });

  logger.info(`Generated download URL for bill ${billId}`);

  return { url };
});
