// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import * as logger from "firebase-functions/logger";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { defineString } from "firebase-functions/params";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { buildInvoicePdf } from "./build_invoice_pdf";
import type {
  CheckoutEntity,
  CheckoutItemEntity,
} from "../types/firestore_entities";
import { formatInvoiceNumber } from "./types";
import type {
  InvoiceData,
  InvoiceCheckout,
  PaymentConfig,
  WorkshopInfo,
  BillEntity,
  PersonEntryFee,
} from "./types";

// Payment config from environment params
const paymentIban = defineString("PAYMENT_IBAN");
const paymentRecipientName = defineString("PAYMENT_RECIPIENT_NAME");
const paymentRecipientStreet = defineString("PAYMENT_RECIPIENT_STREET");
const paymentRecipientPostalCode = defineString("PAYMENT_RECIPIENT_POSTAL_CODE");
const paymentRecipientCity = defineString("PAYMENT_RECIPIENT_CITY");
const paymentRecipientCountry = defineString("PAYMENT_RECIPIENT_COUNTRY");
const paymentCurrency = defineString("PAYMENT_CURRENCY");

interface GenerateInvoiceRequest {
  checkoutIds: string[];
}

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

export const generateInvoice = onCall(async (request) => {
  // Auth check
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required");
  }

  const { checkoutIds } = request.data as GenerateInvoiceRequest;
  if (!Array.isArray(checkoutIds) || checkoutIds.length === 0) {
    throw new HttpsError("invalid-argument", "checkoutIds must be a non-empty array");
  }

  // Fix #5: reject duplicate checkout IDs
  const uniqueIds = [...new Set(checkoutIds)];
  if (uniqueIds.length !== checkoutIds.length) {
    throw new HttpsError("invalid-argument", "Duplicate checkout IDs are not allowed");
  }

  const db = getFirestore();
  const callerUid = request.auth.uid;
  const isAdmin = request.auth.token?.admin === true;

  // Load all checkout docs (pre-check outside transaction for fast-fail)
  const checkoutDocs = await Promise.all(
    checkoutIds.map((id) => db.collection("checkouts").doc(id).get())
  );

  for (const doc of checkoutDocs) {
    if (!doc.exists) {
      throw new HttpsError("not-found", `Checkout ${doc.id} not found`);
    }
    const data = doc.data() as CheckoutEntity;

    if (data.status !== "closed") {
      throw new HttpsError("failed-precondition", `Checkout ${doc.id} is not closed`);
    }

    // Authorization: caller owns the checkout or is admin
    const ownerUid = data.userId?.id;
    if (!isAdmin && ownerUid !== callerUid) {
      throw new HttpsError("permission-denied", "Not authorized for this checkout");
    }
  }

  // Load items subcollections in parallel
  const checkoutItems = await Promise.all(
    checkoutDocs.map(async (doc) => {
      const itemsSnap = await doc.ref.collection("items").get();
      return itemsSnap.docs.map((d) => d.data() as CheckoutItemEntity);
    })
  );

  // Load config/pricing for workshop labels and entry fee rates
  const pricingDoc = await db.doc("config/pricing").get();
  const pricingData = pricingDoc.data() as {
    workshops?: Record<string, WorkshopInfo>;
    entryFees?: Record<string, Record<string, number>>;
  } | undefined;
  const workshops = pricingData?.workshops ?? {};
  const configFees = pricingData?.entryFees ?? null;

  // Assemble invoice checkouts
  const invoiceCheckouts: InvoiceCheckout[] = checkoutDocs.map((doc, i) => {
    const data = doc.data() as CheckoutEntity;
    const items = checkoutItems[i];

    // Fix #3: calculate per-person entry fees with correct per-type amounts
    const personEntryFees: PersonEntryFee[] = data.persons.map((person) => ({
      name: person.name,
      userType: person.userType,
      fee: calculateEntryFee(person.userType, data.usageType, configFees),
    }));
    const entryFees = personEntryFees.reduce((sum, pf) => sum + pf.fee, 0);

    const machineCost = data.summary?.machineCost ?? 0;
    const materialCost = data.summary?.materialCost ?? 0;
    const tip = data.summary?.tip ?? 0;
    const totalPrice = data.summary?.totalPrice ?? (entryFees + machineCost + materialCost + tip);

    return {
      date: data.created.toDate(),
      usageType: data.usageType,
      persons: data.persons,
      personEntryFees,
      items,
      workshopsVisited: data.workshopsVisited,
      entryFees,
      machineCost,
      materialCost,
      tip,
      totalPrice,
    };
  });

  const grandTotal = invoiceCheckouts.reduce((sum, c) => sum + c.totalPrice, 0);

  // Determine billing address from first firma person across all checkouts
  let billingAddress: InvoiceData["billingAddress"] = null;
  let recipientName = "";
  for (const checkout of invoiceCheckouts) {
    for (const person of checkout.persons) {
      if (person.userType === "firma" && person.billingAddress) {
        billingAddress = person.billingAddress;
        recipientName = person.billingAddress.company;
        break;
      }
      if (!recipientName) {
        recipientName = person.name;
      }
    }
    if (billingAddress) break;
  }
  if (!recipientName && invoiceCheckouts.length > 0) {
    recipientName = invoiceCheckouts[0].persons[0]?.name ?? "Unbekannt";
  }

  // Build payment config
  const paymentConfig: PaymentConfig = {
    iban: paymentIban.value(),
    recipientName: paymentRecipientName.value(),
    recipientStreet: paymentRecipientStreet.value(),
    recipientPostalCode: paymentRecipientPostalCode.value(),
    recipientCity: paymentRecipientCity.value(),
    recipientCountry: paymentRecipientCountry.value(),
    currency: paymentCurrency.value() || "CHF",
  };

  // Fix #1 & #2: Transaction re-validates billRef, builds PDF before committing storage.
  // If PDF or upload fails after transaction, we clean up.
  const billRef = db.collection("bills").doc();
  let referenceNumber = 0;

  await db.runTransaction(async (tx) => {
    // Re-read checkouts inside transaction to guard against concurrent calls
    const freshDocs = await Promise.all(
      checkoutIds.map((id) => tx.get(db.collection("checkouts").doc(id)))
    );
    for (const doc of freshDocs) {
      const data = doc.data() as CheckoutEntity;
      if (data.billRef) {
        throw new HttpsError("already-exists", `Checkout ${doc.id} already has a bill`);
      }
    }

    const configRef = db.doc("config/billing");
    const configDoc = await tx.get(configRef);

    let nextBillNumber = 1;
    if (configDoc.exists) {
      nextBillNumber = (configDoc.data()?.nextBillNumber as number) ?? 1;
    }

    referenceNumber = nextBillNumber;

    // Increment counter
    if (configDoc.exists) {
      tx.update(configRef, { nextBillNumber: FieldValue.increment(1) });
    } else {
      tx.set(configRef, { nextBillNumber: nextBillNumber + 1 });
    }

    // Create bill
    const bill: BillEntity = {
      userId: checkoutDocs[0].data()!.userId,
      checkouts: checkoutDocs.map((d) => d.ref),
      referenceNumber,
      amount: grandTotal,
      currency: paymentConfig.currency,
      storagePath: null,
      created: Timestamp.now(),
      paidAt: null,
      paidVia: null,
    };
    tx.set(billRef, bill);

    // Set billRef on each checkout
    for (const doc of freshDocs) {
      tx.update(doc.ref, { billRef: billRef });
    }
  });

  // Build PDF and upload — clean up bill on failure
  try {
    const invoiceData: InvoiceData = {
      referenceNumber,
      invoiceDate: new Date(),
      billingAddress,
      recipientName,
      checkouts: invoiceCheckouts,
      workshops,
      grandTotal,
      currency: paymentConfig.currency,
    };

    const pdfBuffer = await buildInvoicePdf(invoiceData, paymentConfig);

    // Upload to Cloud Storage
    const storagePath = `invoices/${billRef.id}.pdf`;
    const bucket = getStorage().bucket();
    const file = bucket.file(storagePath);
    await file.save(pdfBuffer, { contentType: "application/pdf" });

    // Update bill with storage path
    await billRef.update({ storagePath });

    // Generate signed URL (1 hour)
    const [url] = await file.getSignedUrl({
      action: "read",
      expires: Date.now() + 3600 * 1000,
    });

    logger.info(`Generated invoice ${billRef.id} (${formatInvoiceNumber(referenceNumber)}) for ${checkoutIds.length} checkout(s)`);

    return {
      billId: billRef.id,
      url,
      referenceNumber,
    };
  } catch (error) {
    // Roll back: delete bill and clear billRef on checkouts
    logger.error(`PDF generation/upload failed for bill ${billRef.id}, rolling back`, error);
    try {
      const batch = db.batch();
      batch.delete(billRef);
      for (const id of checkoutIds) {
        batch.update(db.collection("checkouts").doc(id), { billRef: null });
      }
      await batch.commit();
    } catch (rollbackErr) {
      logger.error("Rollback failed", rollbackErr);
    }
    throw new HttpsError("internal", "Invoice generation failed");
  }
});
