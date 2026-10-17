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
  // a visit paid during the checkout, "Rechnung_RE-…" for everything payable.
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

  // The linked checkout carries the anonymous creator's uid (for the
  // authorisation below) and the payment method, which picks the
  // Quittung-vs-Rechnung filename (a bill doc doesn't carry it). Fail soft
  // on a missing checkout — the download still works for its owner, just
  // with the default "Rechnung" prefix.
  let checkout: CheckoutEntity | null = null;
  const firstCheckoutRef = bill.checkouts?.[0];
  if (firstCheckoutRef) {
    try {
      checkout =
        ((await firstCheckoutRef.get()).data() as CheckoutEntity | undefined) ??
        null;
    } catch {
      checkout = null;
    }
  }

  // Authorisation:
  //  - never a kiosk session (the `actsAs` claim, minted only by the kiosk):
  //    the shared machine must not keep invoices on its disk (BIL-15,
  //    issue #418), whoever is signed in there, OR
  //  - the account holder (request.auth.uid equals the user doc id), OR
  //  - for a guest bill (no account holder), the anonymous session that
  //    created its checkout (`firebaseUid`, issue #318). Signing the guest
  //    out ends that session, so a guest can fetch the PDF only during the
  //    checkout it just finished (issue #750). A guest bill has exactly
  //    one checkout (only a Sammelrechnung aggregates several, and a guest
  //    can't pay by one — BIL-4), so its first checkout is the one, OR
  //  - admin.
  const isAdmin = request.auth.token.admin === true;
  const claims = request.auth.token as {
    actsAs?: unknown;
    firebase?: { sign_in_provider?: string };
  };
  if (typeof claims.actsAs === "string" && claims.actsAs.length > 0) {
    throw new HttpsError("permission-denied", "No PDF download at the kiosk");
  }
  const isOwner = bill.userId != null && bill.userId.id === request.auth.uid;
  const isAnonCreator =
    bill.userId == null &&
    claims.firebase?.sign_in_provider === "anonymous" &&
    checkout?.firebaseUid === request.auth.uid;

  if (!isAdmin && !isOwner && !isAnonCreator) {
    throw new HttpsError("permission-denied", "Access denied");
  }

  if (!bill.storagePath) {
    throw new HttpsError("failed-precondition", "PDF not yet generated");
  }

  const paymentMethod: PaymentMethod | null = checkout?.paymentMethod ?? null;

  const file = getStorage().bucket().file(bill.storagePath);
  const url = await downloadUrlFor(file, buildDownloadOptions(bill, paymentMethod));

  logger.info(`Generated download URL for bill ${billId}`);

  return { url };
};
