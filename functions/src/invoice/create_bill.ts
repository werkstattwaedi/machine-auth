// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Firestore trigger: auto-create a bill when a checkout is closed.
 *
 * Fires on update of checkouts/{checkoutId}. When status transitions to
 * "closed" and no billRef exists, creates a bill document with a sequential
 * reference number. The bill starts with no PDF — PDF generation and email
 * are handled by bill_triggers.ts.
 */

import * as logger from "firebase-functions/logger";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import type {
  CheckoutEntity,
  CheckoutItemEntity,
} from "../types/firestore_entities";
import type { BillEntity } from "./types";

/** Hardcoded entry fee lookup (mirrors web/modules/lib/pricing.ts) */
const ENTRY_FEES: Record<string, Record<string, number>> = {
  erwachsen: { regular: 15, materialbezug: 0, intern: 0, hangenmoos: 15 },
  kind: { regular: 7.5, materialbezug: 0, intern: 0, hangenmoos: 7.5 },
  firma: { regular: 30, materialbezug: 0, intern: 0, hangenmoos: 30 },
};

function calculateEntryFee(
  userType: string,
  usageType: string,
  configFees?: Record<string, Record<string, number>> | null,
): number {
  if (configFees) {
    const row = configFees[userType];
    if (row && usageType in row) return row[usageType] ?? 0;
  }
  return ENTRY_FEES[userType]?.[usageType] ?? 0;
}

export const onCheckoutClosed = onDocumentUpdated(
  "checkouts/{checkoutId}",
  async (event) => {
    const before = event.data?.before.data() as CheckoutEntity | undefined;
    const after = event.data?.after.data() as CheckoutEntity | undefined;

    if (!before || !after) return;

    // Only proceed if status just changed to "closed" and no bill exists yet
    if (before.status === "closed" || after.status !== "closed") return;
    if (after.billRef) return;

    const checkoutRef = event.data!.after.ref;
    const db = getFirestore();

    // Load items subcollection
    const itemsSnap = await checkoutRef.collection("items").get();
    const items = itemsSnap.docs.map((d) => d.data() as CheckoutItemEntity);

    // Load pricing config for entry fees
    const pricingDoc = await db.doc("config/pricing").get();
    const pricingData = pricingDoc.data() as {
      entryFees?: Record<string, Record<string, number>>;
    } | undefined;
    const configFees = pricingData?.entryFees ?? null;

    // Calculate totals — prefer checkout summary if available
    let grandTotal: number;
    if (after.summary?.totalPrice != null) {
      grandTotal = after.summary.totalPrice;
    } else {
      const entryFees = after.persons.reduce(
        (sum, p) => sum + calculateEntryFee(p.userType, after.usageType, configFees),
        0,
      );
      const machineCost = items
        .filter((i) => i.origin === "nfc")
        .reduce((sum, i) => sum + i.totalPrice, 0);
      const materialCost = items
        .filter((i) => i.origin !== "nfc")
        .reduce((sum, i) => sum + i.totalPrice, 0);
      grandTotal = entryFees + machineCost + materialCost;
    }

    // Transaction: allocate reference number and create bill
    const billRef = db.collection("bills").doc();

    await db.runTransaction(async (tx) => {
      // Re-read checkout inside transaction to guard against concurrent triggers
      const freshDoc = await tx.get(checkoutRef);
      const freshData = freshDoc.data() as CheckoutEntity;
      if (freshData.billRef) {
        logger.info(`Checkout ${checkoutRef.id} already has a bill, skipping`);
        return;
      }

      // Allocate sequential reference number
      const configRef = db.doc("config/billing");
      const configDoc = await tx.get(configRef);
      let nextBillNumber = 1;
      if (configDoc.exists) {
        nextBillNumber = (configDoc.data()?.nextBillNumber as number) ?? 1;
      }

      if (configDoc.exists) {
        tx.update(configRef, { nextBillNumber: FieldValue.increment(1) });
      } else {
        tx.set(configRef, { nextBillNumber: nextBillNumber + 1 });
      }

      // Create bill document
      const bill: BillEntity = {
        userId: after.userId,
        checkouts: [checkoutRef],
        referenceNumber: nextBillNumber,
        amount: grandTotal,
        currency: "CHF",
        storagePath: null,
        created: Timestamp.now(),
        paidAt: null,
        paidVia: null,
      };
      tx.set(billRef, bill);

      // Link bill to checkout
      tx.update(checkoutRef, { billRef: billRef });
    });

    logger.info(
      `Created bill ${billRef.id} for checkout ${checkoutRef.id}`,
    );
  },
);
