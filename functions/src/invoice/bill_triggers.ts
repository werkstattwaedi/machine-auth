// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Bill lifecycle triggers and retry:
 * - onBillCreate: fast path — attempt PDF generation + email
 * - retryBillProcessing: scheduled every 15 min — retry failures
 *
 * PDF generation and email sending use optimistic locking via timestamp
 * fields (pdfGeneratedAt, emailSentAt) to prevent concurrent processing.
 * Failures are logged to the operations_log collection for debugging.
 */

import * as logger from "firebase-functions/logger";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret, defineString } from "firebase-functions/params";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { Resend } from "resend";
import { formatWorkshopDateTime } from "../util/workshop_timezone";
import { buildInvoicePdf } from "./build_invoice_pdf";
import { formatInvoiceNumber } from "./types";
import { logOperationError } from "../operations_log";
import type {
  BillEntity,
  InvoiceData,
  InvoiceCheckout,
  PaymentConfig,
  WorkshopInfo,
  PersonEntryFee,
} from "./types";
import type {
  CheckoutEntity,
  CheckoutItemEntity,
} from "../types/firestore_entities";

// --- Params ---

const paymentIban = defineString("PAYMENT_IBAN");
const paymentRecipientName = defineString("PAYMENT_RECIPIENT_NAME");
const paymentRecipientStreet = defineString("PAYMENT_RECIPIENT_STREET");
const paymentRecipientPostalCode = defineString("PAYMENT_RECIPIENT_POSTAL_CODE");
const paymentRecipientCity = defineString("PAYMENT_RECIPIENT_CITY");
const paymentRecipientCountry = defineString("PAYMENT_RECIPIENT_COUNTRY");
const paymentCurrency = defineString("PAYMENT_CURRENCY");

const resendApiKey = defineSecret("RESEND_API_KEY");
const resendFromEmail = defineString("RESEND_FROM_EMAIL");
const resendQrBillTemplateId = defineString("RESEND_QRBILL_TEMPLATE_ID");

// Stale lock threshold: if a lock is older than this, treat it as failed
const STALE_LOCK_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Look up the per-person entry fee from `config/pricing.entryFees`.
 *
 * Throws when the config row is missing (issue #149). The previous silent
 * fallback shipped hardcoded prices that diverged from the seeded
 * production values, so a misconfigured Firestore document would have
 * silently misbilled every checkout. Throwing here puts the bill into
 * the documented "needs ops attention" state via the trigger's existing
 * logOperationError path instead of emitting a wrong PDF.
 */
function calculateEntryFee(
  userType: string,
  usageType: string,
  configFees?: Record<string, Record<string, number>> | null,
): number {
  if (configFees) {
    const row = configFees[userType];
    if (row && usageType in row) {
      const value = row[usageType];
      if (typeof value === "number") return value;
    }
  }
  throw new Error(
    `Pricing config missing entry fee for ${userType}/${usageType}`,
  );
}

// --- Helpers ---

function buildPaymentConfig(): PaymentConfig {
  return {
    iban: paymentIban.value(),
    recipientName: paymentRecipientName.value(),
    recipientStreet: paymentRecipientStreet.value(),
    recipientPostalCode: paymentRecipientPostalCode.value(),
    recipientCity: paymentRecipientCity.value(),
    recipientCountry: paymentRecipientCountry.value(),
    currency: paymentCurrency.value() || "CHF",
  };
}

/**
 * Assemble InvoiceData from a bill and its checkouts.
 */
async function assembleInvoiceData(
  bill: BillEntity,
  billId: string,
): Promise<InvoiceData> {
  const db = getFirestore();

  // Load pricing config
  const pricingDoc = await db.doc("config/pricing").get();
  const pricingData = pricingDoc.data() as {
    workshops?: Record<string, WorkshopInfo>;
    entryFees?: Record<string, Record<string, number>>;
  } | undefined;
  const workshops = pricingData?.workshops ?? {};
  const configFees = pricingData?.entryFees ?? null;

  // Load all checkouts + items
  const checkoutDocs = await Promise.all(
    bill.checkouts.map((ref) => ref.get()),
  );

  const checkoutItems = await Promise.all(
    checkoutDocs.map(async (doc) => {
      const itemsSnap = await doc.ref.collection("items").get();
      return itemsSnap.docs.map((d) => d.data() as CheckoutItemEntity);
    }),
  );

  // Assemble invoice checkouts
  const invoiceCheckouts: InvoiceCheckout[] = checkoutDocs.map((doc, i) => {
    const data = doc.data() as CheckoutEntity;
    const items = checkoutItems[i];

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

  // Determine billing address
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

  return {
    referenceNumber: bill.referenceNumber,
    invoiceDate: new Date(),
    billingAddress,
    recipientName,
    checkouts: invoiceCheckouts,
    workshops,
    grandTotal: bill.amount,
    currency: bill.currency,
    paidAt: bill.paidAt?.toDate() ?? null,
    paidVia: bill.paidVia ?? null,
  };
}

// --- Async processing with optimistic locking ---

/**
 * Attempt to generate a PDF for a bill. Uses pdfGeneratedAt as an
 * optimistic lock to prevent concurrent generation.
 *
 * Returns true if the PDF was generated (or already exists).
 *
 * Exported for integration testing — invoked directly to bypass the
 * Firestore trigger wrapper.
 */
export async function tryGeneratePdf(billId: string): Promise<boolean> {
  const db = getFirestore();
  const billRef = db.collection("bills").doc(billId);

  const billDoc = await billRef.get();
  if (!billDoc.exists) return false;
  const bill = billDoc.data() as BillEntity;

  // Already generated
  if (bill.storagePath) return true;

  // Another process is working on it (and the lock isn't stale)
  if (bill.pdfGeneratedAt) {
    const lockAge = Date.now() - bill.pdfGeneratedAt.toMillis();
    if (lockAge < STALE_LOCK_MS) return false;
    // Stale lock — clear it and proceed
    logger.warn(`Clearing stale PDF lock for bill ${billId} (${lockAge}ms old)`);
  }

  // Acquire lock
  await billRef.update({ pdfGeneratedAt: Timestamp.now() });

  try {
    const invoiceData = await assembleInvoiceData(bill, billId);
    const paymentConfig = buildPaymentConfig();
    const pdfBuffer = await buildInvoicePdf(invoiceData, paymentConfig);

    const storagePath = `invoices/${billId}.pdf`;
    const bucket = getStorage().bucket();
    const file = bucket.file(storagePath);
    await file.save(pdfBuffer, { contentType: "application/pdf" });

    await billRef.update({ storagePath });
    logger.info(`PDF generated for bill ${billId}`);
    return true;
  } catch (error) {
    // Release lock on failure
    await billRef.update({ pdfGeneratedAt: null });
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`PDF generation failed for bill ${billId}`, { error: message });
    await logOperationError("bills", billId, "pdf_generate", message);
    return false;
  }
}

/**
 * Attempt to send the invoice email for a bill. Uses emailSentAt as an
 * optimistic lock to prevent duplicate sends.
 *
 * Returns true if the email was sent (or already sent, or skipped in emulator).
 *
 * Exported for integration testing — invoked directly to bypass the
 * Firestore trigger wrapper.
 */
export async function trySendEmail(billId: string): Promise<boolean> {
  if (process.env.FUNCTIONS_EMULATOR === "true") {
    logger.info(`Emulator: skipping email for bill ${billId}`);
    return true;
  }

  const db = getFirestore();
  const billRef = db.collection("bills").doc(billId);

  const billDoc = await billRef.get();
  if (!billDoc.exists) return false;
  const bill = billDoc.data() as BillEntity;

  // No PDF yet — can't send email without attachment
  if (!bill.storagePath) return false;

  // Already sent or in-progress. On failure the catch block clears
  // emailSentAt to null so the retry picks it up. A process crash
  // mid-send would leave emailSentAt stuck — rare enough to handle manually.
  if (bill.emailSentAt) return false;

  // Get recipient email from first checkout
  if (bill.checkouts.length === 0) return false;
  const checkoutDoc = await bill.checkouts[0].get();
  if (!checkoutDoc.exists) return false;
  const checkout = checkoutDoc.data() as CheckoutEntity;
  const recipientEmail = checkout.persons[0]?.email;
  if (!recipientEmail) {
    logger.warn(`Bill ${billId}: no recipient email, skipping`);
    return true; // Nothing to retry
  }

  // Acquire lock
  await billRef.update({ emailSentAt: Timestamp.now() });

  try {
    const bucket = getStorage().bucket();
    const file = bucket.file(bill.storagePath);
    const [signedUrl] = await file.getSignedUrl({
      action: "read",
      expires: Date.now() + 24 * 3600 * 1000,
    });

    const invoiceNumber = formatInvoiceNumber(bill.referenceNumber);
    const recipientName = checkout.persons[0]?.name ?? "Kunde";
    const checkoutDate = formatWorkshopDateTime(
      checkout.created.toDate(),
      "dd. MMMM yyyy, HH:mm",
    );

    const resend = new Resend(resendApiKey.value());
    const { error } = await resend.emails.send({
      from: resendFromEmail.value(),
      to: recipientEmail,
      template: {
        id: resendQrBillTemplateId.value(),
        variables: {
          RECIPIENT_NAME: recipientName,
          CHECKOUT_DATE: checkoutDate,
          INVOICE_NUMBER: invoiceNumber,
          AMOUNT: bill.amount.toFixed(2),
          CURRENCY: bill.currency,
        },
      },
      attachments: [
        {
          path: signedUrl,
          filename: `Rechnung-${invoiceNumber}.pdf`,
        },
      ],
    });

    if (error) {
      throw new Error(JSON.stringify(error));
    }

    logger.info(`Invoice email sent for bill ${billId} to ${recipientEmail}`);
    return true;
  } catch (error) {
    // Release lock on failure
    await billRef.update({ emailSentAt: null });
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Email send failed for bill ${billId}`, { error: message });
    await logOperationError("bills", billId, "email_send", message);
    return false;
  }
}

// --- Triggers ---

/**
 * Fast path: when a bill is created, attempt PDF generation and email.
 * Failures are silently caught — the retry function will pick them up.
 */
export const onBillCreate = onDocumentCreated(
  {
    document: "bills/{billId}",
    timeoutSeconds: 120,
    secrets: [resendApiKey],
  },
  async (event) => {
    const billId = event.params.billId;
    if (!event.data?.data()) {
      logger.error(`onBillCreate: no data for bill ${billId}`);
      return;
    }

    const pdfOk = await tryGeneratePdf(billId);
    if (pdfOk) {
      await trySendEmail(billId);
    }
  },
);

/**
 * Scheduled retry: pick up bills where PDF generation or email sending
 * failed. Runs every 15 minutes, processes bills created in the last 24h.
 */
export const retryBillProcessing = onSchedule(
  {
    schedule: "every 15 minutes",
    secrets: [resendApiKey],
    timeoutSeconds: 120,
  },
  async () => {
    const db = getFirestore();
    const cutoff = Timestamp.fromMillis(Date.now() - 24 * 3600 * 1000);

    const recentBills = await db
      .collection("bills")
      .where("created", ">", cutoff)
      .get();

    let pdfRetries = 0;
    let emailRetries = 0;

    for (const doc of recentBills.docs) {
      const bill = doc.data() as BillEntity;
      const billId = doc.id;

      // Needs PDF: no storagePath, no active lock (or stale lock)
      if (!bill.storagePath) {
        const isLocked = bill.pdfGeneratedAt &&
          Date.now() - bill.pdfGeneratedAt.toMillis() < STALE_LOCK_MS;
        if (!isLocked) {
          pdfRetries++;
          const pdfOk = await tryGeneratePdf(billId);
          if (pdfOk) {
            emailRetries++;
            await trySendEmail(billId);
          }
        }
        continue;
      }

      // PDF exists but email not sent
      if (!bill.emailSentAt) {
        emailRetries++;
        await trySendEmail(billId);
      }
    }

    if (pdfRetries > 0 || emailRetries > 0) {
      logger.info(`Bill retry: ${pdfRetries} PDF, ${emailRetries} email attempts`);
    }
  },
);
