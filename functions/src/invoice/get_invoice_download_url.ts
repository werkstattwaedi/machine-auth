// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import * as logger from "firebase-functions/logger";
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { downloadUrlFor } from "../util/storage_download";
import { billDocumentPrefix, formatBillReference, type BillEntity } from "./types";
import type { CheckoutEntity, PaymentMethod } from "../types/firestore_entities";

/**
 * Build the options passed to `file.getSignedUrl(...)` for a bill download.
 * Factored out as a pure function so we can regression-test the
 * Content-Disposition header without a callable-test harness.
 */
export function buildDownloadOptions(
  bill: BillEntity,
  paymentMethod: PaymentMethod | null = null,
): {
  action: "read";
  expires: number;
  responseDisposition: string;
} {
  // Filename mirrors the document type inside the PDF (issue #405 for
  // Belege, #426 follow-up for TWINT): "Beleg_BL-…", "Quittung_RE-…" for
  // a TWINT-settled visit, "Rechnung_RE-…" for everything payable.
  const reference = formatBillReference(bill.referenceNumber, bill.kind);
  const prefix = billDocumentPrefix(bill.kind, paymentMethod);
  const filename = `${prefix}_${reference}.pdf`;
  return {
    action: "read",
    expires: Date.now() + 3600 * 1000,
    responseDisposition: `attachment; filename="${filename}"`,
  };
}

export const getInvoiceDownloadUrlHandler = async (
  request: CallableRequest<unknown>,
) => {
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
  // For real logins, request.auth.uid equals the user doc id. For kiosk
  // tag-tap sessions, the uid is synthetic and the actsAs claim names the
  // real user — match against either.
  const claims = request.auth.token as { actsAs?: unknown };
  const actsAs = typeof claims.actsAs === "string" ? claims.actsAs : null;
  const isOwner =
    bill.userId.id === request.auth.uid ||
    (actsAs !== null && bill.userId.id === actsAs);

  if (!isAdmin && !isOwner) {
    throw new HttpsError("permission-denied", "Access denied");
  }

  if (!bill.storagePath) {
    throw new HttpsError("failed-precondition", "PDF not yet generated");
  }

  // The Quittung-vs-Rechnung filename needs the checkout's payment method
  // (a bill doc doesn't carry it). Fail soft on a missing checkout — the
  // download still works, just with the default "Rechnung" prefix.
  let paymentMethod: PaymentMethod | null = null;
  const firstCheckoutRef = bill.checkouts?.[0];
  if (firstCheckoutRef) {
    try {
      const checkoutSnap = await firstCheckoutRef.get();
      paymentMethod =
        (checkoutSnap.data() as CheckoutEntity | undefined)?.paymentMethod ??
        null;
    } catch {
      paymentMethod = null;
    }
  }

  const file = getStorage().bucket().file(bill.storagePath);
  const url = await downloadUrlFor(file, buildDownloadOptions(bill, paymentMethod));

  logger.info(`Generated download URL for bill ${billId}`);

  return { url };
};
