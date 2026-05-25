// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Scheduled renewal invoicer (issue #323).
 *
 * Annual memberships no longer renew by tapping back through the
 * Self-Checkout wizard. Instead, ~30 days before a membership's
 * `validUntil`, this daily cron auto-issues a QR-Rechnung — the same
 * kind of bill a checkout produces — and lets the existing gated-ack
 * pipeline mail it and (once paid/acked) extend the membership.
 *
 * Mechanism (deliberately reuses the established bill machinery so the
 * PDF / email / membership-activation paths are all unchanged):
 *
 *  1. Find memberships with `validUntil` in the 1-day slice at the
 *     30-day horizon, `autoRenew != false`, `pendingRenewalBill == null`.
 *  2. For each, write a synthetic *closed* `checkouts` doc carrying the
 *     membership-fee SKU (paymentMethod "rechnung") plus a `bills` doc
 *     via `allocateBill` with `source: "membership-renewal"`, linked to
 *     that checkout. The synthetic checkout is what makes the existing
 *     `assembleInvoiceData` (PDF), `trySendEmail` (recipient lookup) and
 *     `processMembershipForAckedBill` (membership extension via
 *     `paymentCheckouts`) all work without renewal-specific branches.
 *  3. Stamp `pendingRenewalBill` on the membership so re-runs skip it.
 *
 * From there the standard pipeline takes over: `onBillCreate` renders the
 * PDF; the `autoAcknowledgeBills` cron (or a future explicit payment
 * receipt) flips `paymentMethodConfirmationTime`, which fires
 * `trySendEmail` + `processMembershipForAckedBill` → `applyMembershipPayment`
 * extends `validUntil` by one year and clears `pendingRenewalBill`.
 *
 * Idempotency:
 *  - The `pendingRenewalBill == null` query filter means a second tick on
 *    the same day (or a retry) does not open a second bill.
 *  - `applyMembershipPayment`'s `paymentCheckouts` arrayUnion makes the
 *    eventual extension idempotent regardless of trigger retries.
 *
 * The plan's literal "no checkouts doc" was relaxed here: every
 * downstream bill consumer reads the linked checkout (recipient email,
 * line items, payer for the QR slip, membership extension), so a synthetic
 * closed checkout is the least-surprising way to ride the existing path
 * instead of forking the PDF/email/activation code.
 */

import * as logger from "firebase-functions/logger";
import { onSchedule } from "firebase-functions/v2/scheduler";
import {
  getFirestore,
  Timestamp,
  type DocumentReference,
  type Firestore,
} from "firebase-admin/firestore";
import type {
  CatalogEntity,
  CatalogReferencesEntity,
  CheckoutEntity,
  CheckoutItemEntity,
  MembershipEntity,
  UserEntity,
} from "../types/firestore_entities";
import { priceForTier } from "../types/firestore_entities";
import { allocateBill } from "../invoice/create_bill";
import { formatFullName } from "../util/username-utils";

/** Days before `validUntil` to issue the renewal invoice (issue #323, Q1). */
export const RENEWAL_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Cap per run so a backlog can't OOM / runaway-write. */
const BATCH_LIMIT = 500;

export interface RenewalInvoicerSummary {
  /** Memberships in the renewal slice this tick. */
  scannedMemberships: number;
  /** Memberships skipped because autoRenew is explicitly false. */
  skippedAutoRenewOff: number;
  /** Memberships skipped because a renewal bill is already open. */
  skippedPending: number;
  /** Memberships skipped because their data was incomplete (no owner/SKU). */
  skippedIncomplete: number;
  /** Bill doc ids created this run. */
  billIds: string[];
}

/**
 * Resolve the membership-fee catalog doc + the variant for a membership
 * type, returning the renewal (member-tier) unit price. Returns null when
 * the SKU isn't configured — the caller skips that membership.
 */
async function resolveRenewalSku(
  database: Firestore,
  type: "single" | "family",
): Promise<{
  catalogRef: DocumentReference;
  catalog: CatalogEntity;
  variantId: string;
  label: string;
  pricingModel: CatalogEntity["variants"][number]["pricingModel"];
  unitPrice: number;
} | null> {
  const refsSnap = await database.doc("config/catalog-references").get();
  const refs = refsSnap.data() as CatalogReferencesEntity | undefined;
  if (!refs?.membership) return null;
  const catalogSnap = await refs.membership.get();
  if (!catalogSnap.exists) return null;
  const catalog = catalogSnap.data() as CatalogEntity;
  if (!catalog.active) return null;
  const variant = catalog.variants?.find((v) => v.id === type);
  if (!variant) return null;
  // Renewals always pay the member tier (an active member is renewing).
  const unitPrice = priceForTier(variant.unitPrice, "member");
  if (!Number.isFinite(unitPrice) || unitPrice <= 0) return null;
  return {
    catalogRef: refs.membership,
    catalog,
    variantId: variant.id,
    label: variant.label
      ? `${catalog.name} — ${variant.label}`
      : catalog.name,
    pricingModel: variant.pricingModel,
    unitPrice,
  };
}

/**
 * Core loop, exported so the integration test can invoke it directly
 * against the Firestore emulator (no scheduler runtime needed).
 */
export async function runRenewalInvoicer(
  now: Date = new Date(),
): Promise<RenewalInvoicerSummary> {
  const database = getFirestore();

  // The 1-day slice at the 30-day horizon. A membership is invoiced on the
  // single tick where its `validUntil` lands in [now+29d, now+30d). Keeping
  // it to one slice (rather than "<= now+30d") bounds the work and means a
  // missed day's memberships fall to the next tick's slice — combined with
  // the `pendingRenewalBill` guard this is safe against double-invoicing.
  const lower = Timestamp.fromMillis(
    now.getTime() + (RENEWAL_WINDOW_DAYS - 1) * DAY_MS,
  );
  const upper = Timestamp.fromMillis(
    now.getTime() + RENEWAL_WINDOW_DAYS * DAY_MS,
  );

  const snap = await database
    .collection("memberships")
    .where("validUntil", ">=", lower)
    .where("validUntil", "<", upper)
    .limit(BATCH_LIMIT)
    .get();

  const summary: RenewalInvoicerSummary = {
    scannedMemberships: snap.size,
    skippedAutoRenewOff: 0,
    skippedPending: 0,
    skippedIncomplete: 0,
    billIds: [],
  };

  for (const doc of snap.docs) {
    const membership = doc.data() as MembershipEntity;

    // autoRenew defaults to true when absent (legacy docs renew until
    // explicitly cancelled — see backfill-membership-autorenew.ts).
    if (membership.autoRenew === false) {
      summary.skippedAutoRenewOff++;
      continue;
    }
    // A renewal bill is already open for this membership.
    if (membership.pendingRenewalBill != null) {
      summary.skippedPending++;
      continue;
    }
    // Only active memberships renew — cancelled/expired ones don't (and a
    // cancelled doc keeps its validUntil for audit, so it could match the
    // slice).
    if (membership.status !== "active") {
      summary.skippedIncomplete++;
      continue;
    }

    const ownerRef = membership.ownerUserId;
    if (!ownerRef) {
      summary.skippedIncomplete++;
      continue;
    }
    const ownerSnap = await ownerRef.get();
    if (!ownerSnap.exists) {
      logger.warn("renewalInvoicer: owner doc missing, skipping", {
        membershipId: doc.id,
        ownerId: ownerRef.id,
      });
      summary.skippedIncomplete++;
      continue;
    }
    const owner = ownerSnap.data() as UserEntity;

    const sku = await resolveRenewalSku(database, membership.type);
    if (!sku) {
      logger.warn("renewalInvoicer: membership SKU not configured, skipping", {
        membershipId: doc.id,
        type: membership.type,
      });
      summary.skippedIncomplete++;
      continue;
    }

    const now2 = Timestamp.now();
    const checkoutRef = database.collection("checkouts").doc();
    const billRef = database.collection("bills").doc();
    const itemRef = checkoutRef.collection("items").doc();

    const checkout: CheckoutEntity = {
      userId: ownerRef,
      status: "closed",
      usageType: "materialbezug",
      created: now2,
      closedAt: now2,
      workshopsVisited: [],
      persons: [
        {
          name: formatFullName(owner, owner.email ?? ""),
          email: owner.email ?? "",
          userType: owner.userType ?? "erwachsen",
          userRef: ownerRef,
        },
      ],
      // The renewal is a real QR-Rechnung; mark the method up front so the
      // email picks the QR-bill template and the PDF renders the slip.
      paymentMethod: "rechnung",
      billRef,
      modifiedBy: null,
      modifiedAt: now2,
    };
    const item: CheckoutItemEntity = {
      workshop: "diverses",
      description: sku.label,
      origin: "manual",
      catalogId: sku.catalogRef,
      variantId: sku.variantId,
      pricingModel: sku.pricingModel,
      created: now2,
      quantity: 1,
      unitPrice: sku.unitPrice,
      totalPrice: sku.unitPrice,
    };

    try {
      await database.runTransaction(async (tx) => {
        // Re-read the membership inside the txn so a concurrent tick / a
        // payment that landed between the outer query and here can't make
        // us open a duplicate renewal bill.
        const fresh = await tx.get(doc.ref);
        if (!fresh.exists) return;
        const freshMembership = fresh.data() as MembershipEntity;
        if (freshMembership.pendingRenewalBill != null) return;
        if (freshMembership.autoRenew === false) return;
        if (freshMembership.status !== "active") return;

        // allocateBill performs its own read (config/billing) before
        // writing the bill — Firestore requires all reads to precede all
        // writes in a transaction, so it must run before the tx.set/update
        // calls below (which are pure writes).
        await allocateBill(tx, database, {
          userId: ownerRef,
          checkoutRefs: [checkoutRef],
          amount: sku.unitPrice,
          billRef,
          source: "membership-renewal",
        });
        tx.set(checkoutRef, checkout);
        tx.set(itemRef, item);
        tx.update(doc.ref, { pendingRenewalBill: billRef });
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("renewalInvoicer: failed to open renewal bill", {
        membershipId: doc.id,
        error: message,
      });
      continue;
    }

    // The txn may have been a no-op (lost the race) — confirm the bill
    // actually got written before counting it.
    const billSnap = await billRef.get();
    if (!billSnap.exists) {
      summary.skippedPending++;
      continue;
    }
    summary.billIds.push(billRef.id);
    logger.info("renewalInvoicer: opened renewal bill", {
      membershipId: doc.id,
      billId: billRef.id,
      checkoutId: checkoutRef.id,
      amount: sku.unitPrice,
    });
  }

  logger.info("renewalInvoicer: complete", summary);
  return summary;
}

/**
 * Scheduled trigger. Daily — region matches the sibling scheduled bill
 * functions (`monthlyBillRun`, `autoAcknowledgeBills`). PDF rendering and
 * email sending happen downstream via `onBillCreate` / `onBillUpdate`, so
 * this function itself only does Firestore writes.
 */
export const issueMembershipRenewalBills = onSchedule(
  {
    schedule: "every 24 hours",
    region: "europe-west6",
    timeoutSeconds: 540,
  },
  async () => {
    await runRenewalInvoicer();
  },
);
