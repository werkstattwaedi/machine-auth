// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import * as logger from "firebase-functions/logger";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { defineString } from "firebase-functions/params";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { generateScorReference } from "./scor_reference";
import { buildInvoicePdf } from "./build_invoice_pdf";
import type {
  CheckoutEntity,
  CheckoutItemEntity,
} from "../types/firestore_entities";
import type {
  InvoiceData,
  InvoiceCheckout,
  PaymentConfig,
  WorkshopInfo,
  BillEntity,
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

  const db = getFirestore();
  const callerUid = request.auth.uid;
  const isAdmin = request.auth.token?.admin === true;

  // Load all checkout docs
  const checkoutDocs = await Promise.all(
    checkoutIds.map((id) => db.collection("checkouts").doc(id).get())
  );

  // Validate all checkouts
  for (const doc of checkoutDocs) {
    if (!doc.exists) {
      throw new HttpsError("not-found", `Checkout ${doc.id} not found`);
    }
    const data = doc.data() as CheckoutEntity;

    if (data.status !== "closed") {
      throw new HttpsError("failed-precondition", `Checkout ${doc.id} is not closed`);
    }
    if (data.billRef) {
      throw new HttpsError("already-exists", `Checkout ${doc.id} already has a bill`);
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

    // Calculate entry fees per person
    let entryFees = 0;
    for (const person of data.persons) {
      entryFees += calculateEntryFee(person.userType, data.usageType, configFees);
    }

    const machineCost = data.summary?.machineCost ?? 0;
    const materialCost = data.summary?.materialCost ?? 0;
    const tip = data.summary?.tip ?? 0;
    const totalPrice = data.summary?.totalPrice ?? (entryFees + machineCost + materialCost + tip);

    return {
      date: data.created.toDate(),
      usageType: data.usageType,
      persons: data.persons,
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

  // Transaction: increment bill number, create bill, set billRef on checkouts
  const billRef = db.collection("bills").doc();
  let referenceNumber: string;

  await db.runTransaction(async (tx) => {
    const configRef = db.doc("config/billing");
    const configDoc = await tx.get(configRef);

    let nextBillNumber = 1;
    if (configDoc.exists) {
      nextBillNumber = (configDoc.data()?.nextBillNumber as number) ?? 1;
    }

    // Generate SCOR reference from zero-padded bill number
    const payload = String(nextBillNumber).padStart(9, "0");
    referenceNumber = generateScorReference(payload);

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
      referenceNumber: referenceNumber!,
      amount: grandTotal,
      currency: paymentCurrency.value() || "CHF",
      storagePath: null,
      created: Timestamp.now(),
      paidAt: null,
      paidVia: null,
    };
    tx.set(billRef, bill);

    // Set billRef on each checkout
    for (const doc of checkoutDocs) {
      tx.update(doc.ref, { billRef: billRef });
    }
  });

  // Build PDF
  const paymentConfig: PaymentConfig = {
    iban: paymentIban.value(),
    recipientName: paymentRecipientName.value(),
    recipientStreet: paymentRecipientStreet.value(),
    recipientPostalCode: paymentRecipientPostalCode.value(),
    recipientCity: paymentRecipientCity.value(),
    recipientCountry: paymentRecipientCountry.value(),
    currency: paymentCurrency.value() || "CHF",
  };

  const invoiceData: InvoiceData = {
    referenceNumber: referenceNumber!,
    invoiceDate: new Date(),
    billingAddress,
    recipientName,
    checkouts: invoiceCheckouts,
    workshops,
    entryFeeLabels: { erwachsen: "Erwachsen", kind: "Kind (u. 18)", firma: "Firma" },
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

  logger.info(`Generated invoice ${billRef.id} (${referenceNumber!}) for ${checkoutIds.length} checkout(s)`);

  return {
    billId: billRef.id,
    url,
    referenceNumber: referenceNumber!,
  };
});
