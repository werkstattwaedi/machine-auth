// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import * as logger from "firebase-functions/logger";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { formatInvoiceNumber, type BillEntity } from "./types";

/**
 * Build the options passed to `file.getSignedUrl(...)` for a bill download.
 * Factored out as a pure function so we can regression-test the
 * Content-Disposition header without a callable-test harness.
 */
export function buildDownloadOptions(bill: BillEntity): {
  action: "read";
  expires: number;
  responseDisposition: string;
} {
  const filename = `Rechnung_${formatInvoiceNumber(bill.referenceNumber)}.pdf`;
  return {
    action: "read",
    expires: Date.now() + 3600 * 1000,
    responseDisposition: `attachment; filename="${filename}"`,
  };
}

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
  const [url] = await file.getSignedUrl(buildDownloadOptions(bill));

  logger.info(`Generated download URL for bill ${billId}`);

  return { url };
});
