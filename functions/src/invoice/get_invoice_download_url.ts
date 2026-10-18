// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import * as logger from "firebase-functions/logger";
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { downloadUrlFor } from "../util/storage_download";
import { billDocumentOf } from "@oww/shared";
import { billFileName, formatBillReference, type BillEntity } from "./types";
import type { CheckoutEntity } from "../types/firestore_entities";

/**
 * Build the options passed to `file.getSignedUrl(...)` for a bill download.
 * Factored out as a pure function so we can regression-test the
 * Content-Disposition header without a callable-test harness.
 */
export function buildDownloadOptions(
  bill: BillEntity,
  legacyCheckoutMethod: unknown = null,
): {
  action: "read";
  expires: number;
  responseDisposition: string;
} {
  // The file name names the document as its title does (issue #405):
  // "Beleg_BL-…", "Rechnung_RE-…", "Sammelrechnung_RE-…" — or "Quittung_RE-…"
  // for a TWINT bill issued before #763, whose document is resolved from
  // its checkout's method.
  const filename = billFileName(
    billDocumentOf(bill, legacyCheckoutMethod),
    formatBillReference(bill),
  );
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
  // authorisation below) and, for a bill minted before ADR-0052, the
  // payment method its file name depends on. Fail soft on a missing
  // checkout — the download still works for its owner.
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
  //  - the account holder: for real logins request.auth.uid equals the
  //    user doc id; for kiosk tag-tap sessions the uid is synthetic and the
  //    actsAs claim names the real user — match against either. The kiosk
  //    never offers the download (BIL-15); that is the client's call, OR
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
  const actsAs = typeof claims.actsAs === "string" ? claims.actsAs : null;
  const isOwner =
    bill.userId != null &&
    (bill.userId.id === request.auth.uid ||
      (actsAs !== null && bill.userId.id === actsAs));
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

  const file = getStorage().bucket().file(bill.storagePath);
  const url = await downloadUrlFor(
    file,
    buildDownloadOptions(bill, checkout?.paymentMethod ?? null),
  );

  logger.info(`Generated download URL for bill ${billId}`);

  return { url };
};
