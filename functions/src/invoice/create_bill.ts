// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Firestore triggers: auto-create a bill when a checkout is closed.
 *
 * Two triggers handle the two checkout flows:
 * - onCheckoutClosed: fires on update (open → closed), for tag-based checkouts
 * - onCheckoutCreatedClosed: fires on create, for anonymous checkouts created
 *   directly with status "closed"
 */

import * as logger from "firebase-functions/logger";
import {
  onDocumentCreated,
  onDocumentUpdated,
} from "firebase-functions/v2/firestore";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import type {
  DocumentReference,
  Firestore,
  Transaction,
} from "firebase-admin/firestore";
import type {
  CheckoutEntity,
  CheckoutItemEntity,
} from "../types/firestore_entities";
import type { BillEntity, BillKind, BillSource } from "./types";
import { usageDiscount, isMachineItem, type UsageType } from "@oww/shared";

/**
 * Allocate a sequential reference number from `config/billing` and write a
 * bill doc inside the supplied transaction. Shared by every code path that
 * mints a bill — per-visit triggers (`createBillForCheckout`), the
 * `closeCheckoutAndGetPayment` callable, and the monthlyBillRun cron — so
 * the counter increment lives in one place.
 *
 * Returns the constructed bill entity so callers can build PaymentData /
 * trigger downstream PDF generation without re-reading from Firestore.
 */
export async function allocateBill(
  tx: Transaction,
  db: Firestore,
  args: {
    userId: DocumentReference | null;
    checkoutRefs: DocumentReference[];
    amount: number;
    billRef: DocumentReference;
    /** Defaults to "invoice". Pass "beleg" for per-visit Sammelrechnung records. */
    kind?: BillKind;
    /**
     * Pre-ack the bill at creation. Used by the monthlyBillRun cron — the
     * monthly Sammelrechnung is implicitly acked (the member acked by
     * picking monthly on each visit). The acknowledgeBill code paths never
     * pass this — the ack stamp lands later via the callable / auto-ack cron.
     */
     preAck?: { source: "user" | "auto" };
    /**
     * Origin discriminator (issue #323). Defaults to "checkout". The
     * renewalInvoicer cron passes "membership-renewal" to mark bills it
     * auto-issued for an expiring membership.
     */
    source?: BillSource;
  },
): Promise<BillEntity> {
  const configRef = db.doc("config/billing");
  const configDoc = await tx.get(configRef);
  const nextBillNumber = configDoc.exists
    ? (configDoc.data()?.nextBillNumber as number) ?? 1
    : 1;

  if (configDoc.exists) {
    tx.update(configRef, { nextBillNumber: FieldValue.increment(1) });
  } else {
    tx.set(configRef, { nextBillNumber: nextBillNumber + 1 });
  }

  // Issue #237: zero-amount bills (e.g. "Interne Nutzung") are auto-closed
  // as `paidVia: "free"` so they don't sit "unpaid forever" waiting for a
  // bank QR scan that will never come. The PDF generator gates its
  // QR-bill section on `paidAt` already, so the same flag also keeps the
  // payment slip out of the generated invoice.
  const isFree = args.amount === 0;
  const now = Timestamp.now();
  const ackTime = args.preAck ? now : isFree ? now : null;
  const ackSource: "user" | "auto" | null = args.preAck
    ? args.preAck.source
    : isFree
    ? "auto"
    : null;
  const bill: BillEntity = {
    userId: args.userId as DocumentReference,
    checkouts: args.checkoutRefs,
    referenceNumber: nextBillNumber,
    amount: args.amount,
    currency: "CHF",
    storagePath: null,
    created: now,
    paidAt: isFree ? now : null,
    paidVia: isFree ? "free" : null,
    pdfGeneratedAt: null,
    emailSentAt: null,
    paymentMethodConfirmationTime: ackTime,
    paymentMethodConfirmationSource: ackSource,
    kind: args.kind ?? "invoice",
    aggregatedIntoBillRef: null,
    source: args.source ?? "checkout",
  };
  tx.set(args.billRef, bill);
  return bill;
}

/**
 * Look up the per-person entry fee from `config/pricing.entryFees`.
 *
 * Throws when the config row is missing (issue #149). The previous
 * silent-fallback path shipped hardcoded prices that diverged from the
 * seeded production values; throwing here puts the bill into the
 * documented "needs ops attention" state instead of emitting a wrong PDF.
 */
function calculateEntryFee(
  userType: string,
  usageType: string,
  configFees?: Record<string, Record<string, number>> | null,
): number {
  if (configFees) {
    const row = configFees[userType];
    if (row && "regular" in row) {
      const standard = row["regular"];
      if (typeof standard === "number") {
        // Issue #284: standard fee scaled by the usage-type entry-fee
        // discount (hardcoded in @oww/shared).
        return standard * usageDiscount(usageType as UsageType).entryFee;
      }
    }
  }
  throw new Error(
    `Pricing config missing standard entry fee for ${userType} (usageType ${usageType})`,
  );
}

/**
 * Create a bill for a closed checkout. Shared by both triggers.
 *
 * Exported for integration testing — invoke directly to bypass the
 * Firestore trigger wrapper (the Functions emulator is not started in
 * the test harness).
 */
export async function createBillForCheckout(
  checkoutRef: DocumentReference,
  checkout: CheckoutEntity,
): Promise<void> {
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
  if (checkout.summary?.totalPrice != null) {
    grandTotal = checkout.summary.totalPrice;
  } else {
    // Safety-net fallback (the callable normally writes summary.totalPrice).
    // Apply the usage-type discount per section (issue #284). calculateEntryFee
    // already scales the entry fee by its discount multiplier.
    const discount = usageDiscount(checkout.usageType as UsageType);
    const entryFees = checkout.persons.reduce(
      (sum, p) => sum + calculateEntryFee(p.userType, checkout.usageType, configFees),
      0,
    );
    const machineCost =
      items
        .filter((i) => isMachineItem(i))
        .reduce((sum, i) => sum + i.totalPrice, 0) * discount.machine;
    const materialCost =
      items
        .filter((i) => !isMachineItem(i))
        .reduce((sum, i) => sum + i.totalPrice, 0) * discount.material;
    grandTotal = Math.round((entryFees + machineCost + materialCost) * 100) / 100;
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

    await allocateBill(tx, db, {
      userId: checkout.userId,
      checkoutRefs: [checkoutRef],
      amount: grandTotal,
      billRef,
    });

    // Link bill to checkout
    tx.update(checkoutRef, { billRef: billRef });
  });

  logger.info(
    `Created bill ${billRef.id} for checkout ${checkoutRef.id}`,
  );
}

/**
 * Tag-based checkout: status updated from open → closed.
 */
export const onCheckoutClosed = onDocumentUpdated(
  "checkouts/{checkoutId}",
  async (event) => {
    const before = event.data?.before.data() as CheckoutEntity | undefined;
    const after = event.data?.after.data() as CheckoutEntity | undefined;

    if (!before || !after) return;

    // Only proceed if status just changed to "closed" and no bill exists yet
    if (before.status === "closed" || after.status !== "closed") return;
    if (after.billRef) return;

    await createBillForCheckout(event.data!.after.ref, after);
  },
);

/**
 * Anonymous checkout: created directly with status "closed".
 */
export const onCheckoutCreatedClosed = onDocumentCreated(
  "checkouts/{checkoutId}",
  async (event) => {
    const data = event.data?.data() as CheckoutEntity | undefined;
    if (!data) return;

    if (data.status !== "closed") return;
    if (data.billRef) return;

    await createBillForCheckout(event.data!.ref, data);
  },
);
