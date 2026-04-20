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

import { HttpsError, onCall } from "firebase-functions/v2/https";
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
  if (!summary || typeof summary.totalPrice !== "number") {
    throw new HttpsError("invalid-argument", "summary.totalPrice is required");
  }
  if (!usageType) {
    throw new HttpsError("invalid-argument", "usageType is required");
  }

  if (checkoutId) {
    return closeExistingCheckout(request.auth?.uid ?? null, {
      checkoutId,
      usageType,
      persons,
      summary,
    });
  }
  if (newCheckout) {
    return createAnonymousCheckout(request.auth?.uid ?? null, {
      newCheckout,
      usageType,
      persons,
      summary,
    });
  }
  throw new HttpsError(
    "invalid-argument",
    "Either checkoutId or newCheckout is required",
  );
});

async function closeExistingCheckout(
  authUid: string | null,
  args: {
    checkoutId: string;
    usageType: UsageType;
    persons: CheckoutPersonEntity[];
    summary: CheckoutSummaryEntity;
  },
): Promise<PaymentData> {
  if (!authUid) {
    throw new HttpsError(
      "unauthenticated",
      "Sign-in required to close an existing checkout",
    );
  }

  const db = getFirestore();
  const checkoutRef = db.collection("checkouts").doc(args.checkoutId);
  const billRef = db.collection("bills").doc();

  const result = await db.runTransaction(async (tx) => {
    const checkoutDoc = await tx.get(checkoutRef);
    if (!checkoutDoc.exists) {
      throw new HttpsError("not-found", `Checkout ${args.checkoutId} not found`);
    }
    const checkout = checkoutDoc.data() as CheckoutEntity;

    // Mirror the Firestore rule's `isOwner()` check. A null userId on an
    // open checkout (legacy data) can never be claimed by a callable owner.
    if (!checkout.userId || checkout.userId.id !== authUid) {
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

    const bill = await allocateBill(tx, db, {
      userId: checkout.userId,
      checkoutRef,
      amount: args.summary.totalPrice,
      billRef,
    });

    tx.update(checkoutRef, {
      status: "closed",
      usageType: args.usageType,
      persons: args.persons,
      closedAt: FieldValue.serverTimestamp(),
      notes: null,
      summary: args.summary,
      modifiedBy: authUid,
      modifiedAt: FieldValue.serverTimestamp(),
      billRef,
    });

    return { bill, payer: payerFromPersons(args.persons) };
  });

  return buildPaymentData(result.bill, result.payer);
}

async function createAnonymousCheckout(
  authUid: string | null,
  args: {
    newCheckout: NewCheckoutInput;
    usageType: UsageType;
    persons: CheckoutPersonEntity[];
    summary: CheckoutSummaryEntity;
  },
): Promise<PaymentData> {
  // Anti-spoofing: the caller may only stamp their own userId on a new
  // checkout. Unauthenticated callers always create a null-userId checkout
  // (the truly anonymous path); authenticated callers may either omit
  // userId or pass their own auth uid. This preserves the original
  // "identifiedUserRef ?? null" semantic while blocking forgery.
  const requestedUserId = args.newCheckout.userId ?? null;
  if (requestedUserId && requestedUserId !== authUid) {
    throw new HttpsError(
      "permission-denied",
      "userId must match the caller",
    );
  }
  const effectiveUserId = authUid ? requestedUserId : null;

  const db = getFirestore();
  const checkoutRef = db.collection("checkouts").doc();
  const billRef = db.collection("bills").doc();
  const userIdRef = effectiveUserId
    ? db.collection("users").doc(effectiveUserId)
    : null;

  // Pre-allocate item refs so they can be written inside the transaction.
  const itemRefs = args.newCheckout.items.map(() =>
    checkoutRef.collection("items").doc(),
  );

  const result = await db.runTransaction(async (tx) => {
    const bill = await allocateBill(tx, db, {
      userId: userIdRef,
      checkoutRef,
      amount: args.summary.totalPrice,
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
      modifiedBy: authUid,
      modifiedAt: FieldValue.serverTimestamp(),
      closedAt: FieldValue.serverTimestamp(),
      notes: null,
      summary: args.summary,
      billRef,
    });

    args.newCheckout.items.forEach((item, idx) => {
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
