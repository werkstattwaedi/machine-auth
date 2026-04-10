// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Bill lifecycle triggers:
 * - onBillCreate: enqueue a Cloud Task to generate PDF + send email after ~2 min
 * - onBillPaid: immediately regenerate PDF (with "paid" stamp) + send receipt
 * - processBillTask: the delayed task handler that generates PDF + sends email
 */

import * as logger from "firebase-functions/logger";
import { onDocumentCreated, onDocumentUpdated } from "firebase-functions/v2/firestore";
import { onTaskDispatched } from "firebase-functions/v2/tasks";
import { defineSecret, defineString } from "firebase-functions/params";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { CloudTasksClient } from "@google-cloud/tasks";
import { Resend } from "resend";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { buildInvoicePdf } from "./build_invoice_pdf";
import { formatInvoiceNumber } from "./types";
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
const twintAv1 = defineString("TWINT_AV1", { default: "" });
const twintAv2 = defineString("TWINT_AV2", { default: "" });

const resendApiKey = defineSecret("RESEND_API_KEY");
const resendFromEmail = defineString("RESEND_FROM_EMAIL");
const resendTwintTemplateId = defineString("RESEND_TWINT_TEMPLATE_ID");
const resendQrBillTemplateId = defineString("RESEND_QRBILL_TEMPLATE_ID");

// Delay before generating PDF + sending email (seconds)
const BILL_PROCESS_DELAY_SECONDS = 120;

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
    twintAv1: twintAv1.value() || undefined,
    twintAv2: twintAv2.value() || undefined,
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

/**
 * Generate PDF, upload to storage, update bill.storagePath.
 */
async function generateAndUploadPdf(
  billId: string,
  bill: BillEntity,
): Promise<void> {
  const invoiceData = await assembleInvoiceData(bill, billId);
  const paymentConfig = buildPaymentConfig();

  const pdfBuffer = await buildInvoicePdf(invoiceData, paymentConfig);

  const storagePath = `invoices/${billId}.pdf`;
  const bucket = getStorage().bucket();
  const file = bucket.file(storagePath);
  await file.save(pdfBuffer, { contentType: "application/pdf" });

  await getFirestore().collection("bills").doc(billId).update({ storagePath });
}

/**
 * Send invoice email via Resend with the PDF attached.
 */
async function sendEmail(billId: string, bill: BillEntity): Promise<void> {
  const db = getFirestore();

  // Reload bill to get the latest storagePath
  const billDoc = await db.collection("bills").doc(billId).get();
  const latestBill = billDoc.data() as BillEntity;

  if (!latestBill.storagePath) {
    logger.warn(`Bill ${billId} has no PDF, skipping email`);
    return;
  }

  // Get recipient email from first checkout
  if (latestBill.checkouts.length === 0) return;
  const checkoutDoc = await latestBill.checkouts[0].get();
  if (!checkoutDoc.exists) return;
  const checkout = checkoutDoc.data() as CheckoutEntity;
  const recipientEmail = checkout.persons[0]?.email;
  if (!recipientEmail) {
    logger.warn(`Bill ${billId}: no recipient email, skipping`);
    return;
  }

  // Signed URL for attachment
  const bucket = getStorage().bucket();
  const file = bucket.file(latestBill.storagePath);
  const [signedUrl] = await file.getSignedUrl({
    action: "read",
    expires: Date.now() + 24 * 3600 * 1000,
  });

  const invoiceNumber = formatInvoiceNumber(latestBill.referenceNumber);
  const recipientName = checkout.persons[0]?.name ?? "Kunde";
  const checkoutDate = format(
    checkout.created.toDate(),
    "dd. MMMM yyyy, HH:mm",
    { locale: de },
  );

  // TWINT template if paid, QR Bill template if unpaid
  const templateId = latestBill.paidAt
    ? resendTwintTemplateId.value()
    : resendQrBillTemplateId.value();

  const resend = new Resend(resendApiKey.value());
  const { error } = await resend.emails.send({
    from: resendFromEmail.value(),
    to: recipientEmail,
    template: {
      id: templateId,
      variables: {
        RECIPIENT_NAME: recipientName,
        CHECKOUT_DATE: checkoutDate,
        AMOUNT: latestBill.amount.toFixed(2),
        CURRENCY: latestBill.currency,
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
    logger.error("Failed to send invoice email", { billId, error });
    throw new Error(`Email send failed: ${JSON.stringify(error)}`);
  }

  logger.info(`Sent invoice email for bill ${billId} to ${recipientEmail}`);
}

// --- Triggers ---

/**
 * When a bill is created, enqueue a Cloud Task to generate the PDF + send
 * email after a delay. This gives the user time to pay via TWINT first.
 */
export const onBillCreate = onDocumentCreated(
  "bills/{billId}",
  async (event) => {
    const billId = event.params.billId;

    try {
      const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
      const location = process.env.FUNCTION_REGION || "us-central1";

      const client = new CloudTasksClient();
      const queuePath = client.queuePath(
        projectId!,
        location,
        "bill-processing",
      );

      const scheduleTime = new Date(
        Date.now() + BILL_PROCESS_DELAY_SECONDS * 1000,
      );

      // The task URL points to the processBillTask function
      const functionUrl = `https://${location}-${projectId}.cloudfunctions.net/processBillTask`;

      await client.createTask({
        parent: queuePath,
        task: {
          httpRequest: {
            httpMethod: "POST",
            url: functionUrl,
            headers: { "Content-Type": "application/json" },
            body: Buffer.from(JSON.stringify({ data: { billId } })),
            oidcToken: {
              serviceAccountEmail: `${projectId}@appspot.gserviceaccount.com`,
            },
          },
          scheduleTime: {
            seconds: Math.floor(scheduleTime.getTime() / 1000),
          },
        },
      });

      logger.info(`Enqueued bill processing task for ${billId} (${BILL_PROCESS_DELAY_SECONDS}s delay)`);
    } catch (error) {
      logger.error(`Failed to enqueue task for bill ${billId}`, error);
    }
  },
);

/**
 * When a bill's paidAt changes to non-null, immediately (re-)generate
 * the PDF with "paid" stamp and send receipt email.
 */
export const onBillPaid = onDocumentUpdated(
  "bills/{billId}",
  async (event) => {
    const before = event.data?.before.data() as BillEntity | undefined;
    const after = event.data?.after.data() as BillEntity | undefined;

    if (!before || !after) return;

    // Only trigger when paidAt changes from null to non-null
    if (before.paidAt !== null || after.paidAt === null) return;

    const billId = event.params.billId;
    logger.info(`Bill ${billId} marked as paid, generating receipt`);

    try {
      await generateAndUploadPdf(billId, after);
      await sendEmail(billId, after);
    } catch (error) {
      logger.error(`Failed to process paid bill ${billId}`, error);
    }
  },
);

/**
 * Cloud Task handler: generate PDF + send email for a bill.
 * Skipped if the bill was already paid (onBillPaid handles that case).
 */
export const processBillTask = onTaskDispatched(
  {
    retryConfig: {
      maxAttempts: 3,
      minBackoffSeconds: 30,
    },
    secrets: [resendApiKey],
  },
  async (req) => {
    const billId = req.data?.billId as string;
    if (!billId) {
      logger.error("processBillTask: missing billId");
      return;
    }

    const db = getFirestore();
    const billDoc = await db.collection("bills").doc(billId).get();
    if (!billDoc.exists) {
      logger.warn(`processBillTask: bill ${billId} not found`);
      return;
    }

    const bill = billDoc.data() as BillEntity;

    // If already paid and PDF exists, onBillPaid already handled it
    if (bill.paidAt && bill.storagePath) {
      logger.info(`processBillTask: bill ${billId} already processed (paid), skipping`);
      return;
    }

    logger.info(`processBillTask: processing bill ${billId}`);

    await generateAndUploadPdf(billId, bill);
    await sendEmail(billId, bill);
  },
);
