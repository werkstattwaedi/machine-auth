// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import * as logger from "firebase-functions/logger";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { defineSecret, defineString } from "firebase-functions/params";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { Resend } from "resend";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { formatInvoiceNumber } from "./types";
import type { BillEntity } from "./types";
import type { CheckoutEntity } from "../types/firestore_entities";

const resendApiKey = defineSecret("RESEND_API_KEY");
const resendFromEmail = defineString("RESEND_FROM_EMAIL");
const resendTwintTemplateId = defineString("RESEND_TWINT_TEMPLATE_ID");
const resendQrBillTemplateId = defineString("RESEND_QRBILL_TEMPLATE_ID");

interface SendInvoiceEmailRequest {
  billId: string;
}

export const sendInvoiceEmail = onCall(
  { secrets: [resendApiKey] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentication required");
    }

    const { billId } = request.data as SendInvoiceEmailRequest;
    if (!billId || typeof billId !== "string") {
      throw new HttpsError("invalid-argument", "billId is required");
    }

    const db = getFirestore();
    const callerUid = request.auth.uid;
    const isAdmin = request.auth.token?.admin === true;

    // Load bill
    const billDoc = await db.collection("bills").doc(billId).get();
    if (!billDoc.exists) {
      throw new HttpsError("not-found", `Bill ${billId} not found`);
    }
    const bill = billDoc.data() as BillEntity;

    // Authorization: caller owns the bill or is admin
    if (!isAdmin && bill.userId?.id !== callerUid) {
      throw new HttpsError("permission-denied", "Not authorized for this bill");
    }

    // Ensure PDF exists
    if (!bill.storagePath) {
      throw new HttpsError("failed-precondition", "Bill has no invoice PDF");
    }

    // Load first checkout to get recipient email
    if (bill.checkouts.length === 0) {
      throw new HttpsError("failed-precondition", "Bill has no checkouts");
    }
    const checkoutDoc = await bill.checkouts[0].get();
    if (!checkoutDoc.exists) {
      throw new HttpsError("not-found", "Checkout not found");
    }
    const checkout = checkoutDoc.data() as CheckoutEntity;
    const recipientEmail = checkout.persons[0]?.email;
    if (!recipientEmail) {
      throw new HttpsError("failed-precondition", "No recipient email found");
    }

    // Signed URL for Resend to fetch the PDF attachment
    const bucket = getStorage().bucket();
    const file = bucket.file(bill.storagePath);
    const [signedUrl] = await file.getSignedUrl({
      action: "read",
      expires: Date.now() + 24 * 3600 * 1000,
    });

    const invoiceNumber = formatInvoiceNumber(bill.referenceNumber);
    const recipientName = checkout.persons[0]?.name ?? "Kunde";
    const checkoutDate = format(checkout.created.toDate(), "dd. MMMM yyyy, HH:mm", { locale: de });

    // TWINT = already paid, otherwise send QR bill for bank transfer
    const templateId = bill.paidVia === "twint"
      ? resendTwintTemplateId.value()
      : resendQrBillTemplateId.value();

    // Send email via Resend
    const resend = new Resend(resendApiKey.value());
    const { error } = await resend.emails.send({
      from: resendFromEmail.value(),
      to: recipientEmail,
      template: {
        id: templateId,
        variables: {
          RECIPIENT_NAME: recipientName,
          CHECKOUT_DATE: checkoutDate,
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
      logger.error("Failed to send invoice email", { billId, error });
      throw new HttpsError("internal", "Failed to send invoice email");
    }

    logger.info(`Sent invoice email for bill ${billId} to ${recipientEmail}`);
    return { success: true };
  },
);
