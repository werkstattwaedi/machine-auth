// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Callable: submit a checkout (close an open one or create-and-close a new
 * one for the anonymous flow) and return the payment QR data in a single
 * round-trip.
 *
 * Replaces the previous flow where the client wrote the checkout doc, an
 * async Firestore trigger created the bill, and the client then made a
 * second callable round-trip for QR data. That chain stalled on the
 * anonymous path because the security rule for `checkouts` requires
 * `isSignedIn()` for reads, so the client could never observe `billRef`.
 *
 * The Firestore triggers in `create_bill.ts` remain as idempotent safety
 * nets (their guards skip when `billRef` is already set).
 */

import * as logger from "firebase-functions/logger";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import {
  getFirestore,
  FieldValue,
  Timestamp,
  type DocumentReference,
  type Transaction,
} from "firebase-admin/firestore";
import type {
  CheckoutEntity,
  CheckoutItemEntity,
  CheckoutPersonEntity,
  CheckoutSummaryEntity,
  ItemOrigin,
  UsageType,
} from "../types/firestore_entities";
import type { BillEntity } from "./types";
import { buildPaymentData, type PaymentData } from "./get_payment_qr_data";

/**
 * The user the caller is authorized to act as.
 *
 * - Real login: `request.auth.uid` equals the user doc id.
 * - Kiosk tag-tap: `request.auth.uid` is a synthetic UID (`tag:…`); the
 *   `actsAs` claim names the real user. This indirection means the kiosk
 *   session is a different Firebase principal than the user — it cannot
 *   inherit any persistent custom claims (e.g. `admin`).
 *
 * Returns null for unauthenticated callers (the truly-anonymous flow).
 */
function effectiveUid(request: CallableRequest<unknown>): string | null {
  const claims = request.auth?.token as { actsAs?: unknown } | undefined;
  if (typeof claims?.actsAs === "string" && claims.actsAs.length > 0) {
    return claims.actsAs;
  }
  return request.auth?.uid ?? null;
}

/** Hardcoded entry fees (mirrors web/modules/lib/pricing.ts and create_bill.ts). */
const ENTRY_FEES_FALLBACK: Record<string, Record<string, number>> = {
  erwachsen: { regular: 15, materialbezug: 0, intern: 0, hangenmoos: 15 },
  kind: { regular: 7.5, materialbezug: 0, intern: 0, hangenmoos: 7.5 },
  firma: { regular: 30, materialbezug: 0, intern: 0, hangenmoos: 30 },
};

/**
 * Exported for unit tests. Returns the per-person entry fee for a given
 * userType + usageType combo, preferring config/pricing.entryFees and
 * falling back to ENTRY_FEES_FALLBACK with a loud warning.
 */
export function entryFeeFor(
  userType: string,
  usageType: string,
  configFees: Record<string, Record<string, number>> | null,
): number {
  if (configFees) {
    const row = configFees[userType];
    if (row && usageType in row) return row[usageType] ?? 0;
  }
  // Loud signal that config/pricing is missing — staff need to know
  // immediately rather than discover it at month-end reconciliation
  // (Launch Analysis §A8).
  logger.warn("Pricing config missing; using hardcoded fallback fees", {
    userType,
    usageType,
  });
  return ENTRY_FEES_FALLBACK[userType]?.[usageType] ?? 0;
}

/**
 * Authoritative summary computation. The bill always uses what this
 * function returns, never the client-supplied summary. This is the
 * structural defense against a client posting `summary.totalPrice: 0.01`
 * for a 25 CHF visit.
 */
/** Exported for unit tests. */
export function recomputeSummary(
  persons: CheckoutPersonEntity[],
  usageType: UsageType,
  items: { origin: ItemOrigin; totalPrice: number }[],
  configFees: Record<string, Record<string, number>> | null,
  clientTip: number,
): CheckoutSummaryEntity {
  const entryFees = persons.reduce(
    (sum, p) => sum + entryFeeFor(p.userType, usageType, configFees),
    0,
  );
  const machineCost = items
    .filter((i) => i.origin === "nfc")
    .reduce((sum, i) => sum + (i.totalPrice ?? 0), 0);
  const materialCost = items
    .filter((i) => i.origin !== "nfc")
    .reduce((sum, i) => sum + (i.totalPrice ?? 0), 0);
  const tip = Math.max(0, clientTip ?? 0);
  const totalPrice =
    Math.round((entryFees + machineCost + materialCost + tip) * 100) / 100;
  return {
    totalPrice,
    entryFees: Math.round(entryFees * 100) / 100,
    machineCost: Math.round(machineCost * 100) / 100,
    materialCost: Math.round(materialCost * 100) / 100,
    tip: Math.round(tip * 100) / 100,
  };
}

/** Exported for unit tests. Defensive sanity-check on each item before summing it into a bill. */
export function isValidItem(item: { quantity?: number; unitPrice?: number; totalPrice?: number }): boolean {
  return (
    typeof item.quantity === "number" && item.quantity > 0 &&
    typeof item.unitPrice === "number" && item.unitPrice >= 0 &&
    typeof item.totalPrice === "number" && item.totalPrice >= 0
  );
}

/** Log when client-supplied summary diverges from server recompute. */
function logSummaryDivergence(
  context: string,
  client: CheckoutSummaryEntity | undefined,
  server: CheckoutSummaryEntity,
): void {
  if (!client) return;
  if (Math.abs((client.totalPrice ?? 0) - server.totalPrice) > 0.01) {
    logger.warn("Client summary diverges from server recompute", {
      context,
      clientTotal: client.totalPrice,
      serverTotal: server.totalPrice,
    });
  }
}

interface NewCheckoutItemInput {
  workshop: string;
  description: string;
  origin: ItemOrigin;
  catalogId: string | null;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  formInputs?: { quantity: number; unit: string }[];
  pricingModel?: string | null;
}

interface NewCheckoutInput {
  /**
   * Owning user doc id, or null for a truly anonymous checkout. The original
   * pre-callable flow used `addDoc` with `userId: identifiedUserRef ?? null`,
   * so an account/tag user with no pre-existing open checkout still gets
   * their ref set on the new doc.
   */
  userId: string | null;
  workshopsVisited: string[];
  items: NewCheckoutItemInput[];
}

interface CloseCheckoutRequest {
  /** Existing open checkout to close. Mutually exclusive with `newCheckout`. */
  checkoutId?: string;
  /** Data for the anonymous flow that creates a closed checkout in one shot. */
  newCheckout?: NewCheckoutInput;
  usageType: UsageType;
  persons: CheckoutPersonEntity[];
  summary: CheckoutSummaryEntity;
}

export const closeCheckoutAndGetPayment = onCall<
  CloseCheckoutRequest,
  Promise<PaymentData>
>(async (request) => {
  const data = request.data ?? ({} as CloseCheckoutRequest);
  const { checkoutId, newCheckout, usageType, persons, summary } = data;

  if (!Array.isArray(persons) || persons.length === 0) {
    throw new HttpsError("invalid-argument", "persons is required");
  }
  if (!usageType) {
    throw new HttpsError("invalid-argument", "usageType is required");
  }

  const callerUid = effectiveUid(request);

  if (checkoutId) {
    return closeExistingCheckout(callerUid, {
      checkoutId,
      usageType,
      persons,
      clientSummary: summary,
    });
  }
  if (newCheckout) {
    return createAnonymousCheckout(callerUid, {
      newCheckout,
      usageType,
      persons,
      clientSummary: summary,
    });
  }
  throw new HttpsError(
    "invalid-argument",
    "Either checkoutId or newCheckout is required",
  );
});

async function closeExistingCheckout(
  callerUid: string | null,
  args: {
    checkoutId: string;
    usageType: UsageType;
    persons: CheckoutPersonEntity[];
    clientSummary?: CheckoutSummaryEntity;
  },
): Promise<PaymentData> {
  if (!callerUid) {
    throw new HttpsError(
      "unauthenticated",
      "Sign-in required to close an existing checkout",
    );
  }

  const db = getFirestore();
  const checkoutRef = db.collection("checkouts").doc(args.checkoutId);
  const billRef = db.collection("bills").doc();

  // Pricing config read outside the transaction — it's not strongly tied
  // to the checkout's atomicity and changes infrequently.
  const pricingDoc = await db.doc("config/pricing").get();
  const configFees =
    (pricingDoc.data() as { entryFees?: Record<string, Record<string, number>> } | undefined)
      ?.entryFees ?? null;

  const result = await db.runTransaction(async (tx) => {
    const checkoutDoc = await tx.get(checkoutRef);
    if (!checkoutDoc.exists) {
      throw new HttpsError("not-found", `Checkout ${args.checkoutId} not found`);
    }
    const checkout = checkoutDoc.data() as CheckoutEntity;

    // The caller must be the checkout's principal — either the real user
    // (uid match) or a kiosk session acting on their behalf (actsAs claim
    // resolved by effectiveUid above and equal to callerUid).
    if (!checkout.userId || checkout.userId.id !== callerUid) {
      throw new HttpsError("permission-denied", "Not the checkout owner");
    }

    // Idempotency: if the safety-net trigger already produced a bill for
    // this checkout, return that bill's payment data instead of duplicating.
    if (checkout.billRef) {
      const existingBillDoc = await tx.get(checkout.billRef);
      if (existingBillDoc.exists) {
        const existingBill = existingBillDoc.data() as BillEntity;
        return {
          bill: existingBill,
          payer: payerFromPersons(checkout.persons ?? args.persons),
        };
      }
    }

    if (checkout.status !== "open") {
      throw new HttpsError(
        "failed-precondition",
        `Checkout ${args.checkoutId} is not open`,
      );
    }

    // Load the items subcollection inside the transaction for the
    // server-side recompute. Anything that doesn't pass isValidItem is
    // dropped — items already in Firestore have passed the rule-level
    // validation, so this is a defensive secondary check.
    const itemsSnap = await tx.get(checkoutRef.collection("items"));
    const items = itemsSnap.docs
      .map((d) => d.data() as CheckoutItemEntity)
      .filter(isValidItem);

    const summary = recomputeSummary(
      args.persons,
      args.usageType,
      items,
      configFees,
      args.clientSummary?.tip ?? 0,
    );
    logSummaryDivergence(`closeExistingCheckout ${args.checkoutId}`, args.clientSummary, summary);

    const bill = await allocateBill(tx, db, {
      userId: checkout.userId,
      checkoutRef,
      amount: summary.totalPrice,
      billRef,
    });

    tx.update(checkoutRef, {
      status: "closed",
      usageType: args.usageType,
      persons: args.persons,
      closedAt: FieldValue.serverTimestamp(),
      notes: null,
      summary,
      modifiedBy: callerUid,
      modifiedAt: FieldValue.serverTimestamp(),
      billRef,
    });

    return { bill, payer: payerFromPersons(args.persons) };
  });

  return buildPaymentData(result.bill, result.payer);
}

async function createAnonymousCheckout(
  callerUid: string | null,
  args: {
    newCheckout: NewCheckoutInput;
    usageType: UsageType;
    persons: CheckoutPersonEntity[];
    clientSummary?: CheckoutSummaryEntity;
  },
): Promise<PaymentData> {
  // Anti-spoofing: the caller may only stamp their own userId on a new
  // checkout. Unauthenticated callers always create a null-userId checkout
  // (the truly anonymous path); authenticated callers (real login OR tag
  // session via actsAs) may either omit userId or pass an id that matches
  // their effective UID. This preserves the original
  // "identifiedUserRef ?? null" semantic while blocking forgery.
  const requestedUserId = args.newCheckout.userId ?? null;
  if (requestedUserId && requestedUserId !== callerUid) {
    throw new HttpsError(
      "permission-denied",
      "userId must match the caller",
    );
  }
  const effectiveUserId = callerUid ? requestedUserId : null;

  // Items are validated and summed server-side. Negative quantities or
  // prices in the request are silently dropped (rule-level rejection
  // would have caught them on a direct write; here we just don't bill).
  const validItems = args.newCheckout.items.filter(isValidItem);
  if (validItems.length !== args.newCheckout.items.length) {
    logger.warn("createAnonymousCheckout dropped invalid items", {
      total: args.newCheckout.items.length,
      kept: validItems.length,
    });
  }

  const db = getFirestore();
  const pricingDoc = await db.doc("config/pricing").get();
  const configFees =
    (pricingDoc.data() as { entryFees?: Record<string, Record<string, number>> } | undefined)
      ?.entryFees ?? null;

  const summary = recomputeSummary(
    args.persons,
    args.usageType,
    validItems,
    configFees,
    args.clientSummary?.tip ?? 0,
  );
  logSummaryDivergence("createAnonymousCheckout", args.clientSummary, summary);

  const checkoutRef = db.collection("checkouts").doc();
  const billRef = db.collection("bills").doc();
  const userIdRef = effectiveUserId
    ? db.collection("users").doc(effectiveUserId)
    : null;

  // Pre-allocate item refs so they can be written inside the transaction.
  const itemRefs = validItems.map(() => checkoutRef.collection("items").doc());

  const result = await db.runTransaction(async (tx) => {
    const bill = await allocateBill(tx, db, {
      userId: userIdRef,
      checkoutRef,
      amount: summary.totalPrice,
      billRef,
    });

    const now = Timestamp.now();
    tx.set(checkoutRef, {
      userId: userIdRef,
      status: "closed",
      usageType: args.usageType,
      created: now,
      workshopsVisited: args.newCheckout.workshopsVisited,
      persons: args.persons,
      modifiedBy: callerUid,
      modifiedAt: FieldValue.serverTimestamp(),
      closedAt: FieldValue.serverTimestamp(),
      notes: null,
      summary,
      billRef,
    });

    validItems.forEach((item, idx) => {
      const itemDoc: CheckoutItemEntity = {
        workshop: item.workshop,
        description: item.description,
        origin: item.origin,
        catalogId: item.catalogId
          ? db.collection("catalog").doc(item.catalogId)
          : null,
        created: now,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice,
        ...(item.formInputs ? { formInputs: item.formInputs } : {}),
        ...(item.pricingModel
          ? { pricingModel: item.pricingModel as CheckoutItemEntity["pricingModel"] }
          : {}),
      };
      tx.set(itemRefs[idx], itemDoc);
    });

    return { bill, payer: payerFromPersons(args.persons) };
  });

  return buildPaymentData(result.bill, result.payer);
}

/**
 * Allocate a sequential bill number from `config/billing` and write the bill
 * doc inside the supplied transaction. Returns the constructed bill entity
 * for downstream PaymentData assembly.
 */
async function allocateBill(
  tx: Transaction,
  db: FirebaseFirestore.Firestore,
  args: {
    userId: DocumentReference | null;
    checkoutRef: DocumentReference;
    amount: number;
    billRef: DocumentReference;
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

  const bill: BillEntity = {
    userId: args.userId as DocumentReference,
    checkouts: [args.checkoutRef],
    referenceNumber: nextBillNumber,
    amount: args.amount,
    currency: "CHF",
    storagePath: null,
    created: Timestamp.now(),
    paidAt: null,
    paidVia: null,
    pdfGeneratedAt: null,
    emailSentAt: null,
  };
  tx.set(args.billRef, bill);
  return bill;
}

function payerFromPersons(
  persons: CheckoutPersonEntity[],
): { name: string; email?: string } | null {
  const primary = persons[0];
  if (!primary) return null;
  return { name: primary.name, email: primary.email };
}
