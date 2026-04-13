// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Callable function: returns the Swiss QR Bill payload string and the
 * RaiseNow PayLink URL for a bill. The client renders the QR bill as a
 * QR code and links to the PayLink for TWINT payments.
 */

import { HttpsError, onCall } from "firebase-functions/v2/https";
import { defineString } from "firebase-functions/params";
import { getFirestore } from "firebase-admin/firestore";
import { generateScorReference } from "./scor_reference";
import type { BillEntity } from "./types";
import type { CheckoutEntity } from "../types/firestore_entities";

// Payment config from environment params
const paymentIban = defineString("PAYMENT_IBAN");
const paymentRecipientName = defineString("PAYMENT_RECIPIENT_NAME");
const paymentRecipientStreet = defineString("PAYMENT_RECIPIENT_STREET", { default: "" });
const paymentRecipientPostalCode = defineString("PAYMENT_RECIPIENT_POSTAL_CODE");
const paymentRecipientCity = defineString("PAYMENT_RECIPIENT_CITY");
const paymentRecipientCountry = defineString("PAYMENT_RECIPIENT_COUNTRY");
const paymentCurrency = defineString("PAYMENT_CURRENCY");

// RaiseNow PayLink solution ID (the short code in https://pay.raisenow.io/{id})
const raisenowPaylinkSolutionId = defineString("RAISENOW_PAYLINK_SOLUTION_ID");

const RAISENOW_PAYLINK_BASE_URL = "https://pay.raisenow.io";

interface GetPaymentQrDataRequest {
  billId: string;
}

/**
 * Build the Swiss QR Bill payload string (SPC format).
 * Lines 1-31 follow the Swiss Payment Standards spec.
 */
function buildQrPayload(bill: BillEntity, scorReference: string): string {
  const iban = paymentIban.value().replace(/\s/g, "");
  const name = paymentRecipientName.value();
  const street = paymentRecipientStreet.value();
  const postalCode = paymentRecipientPostalCode.value();
  const city = paymentRecipientCity.value();
  const country = paymentRecipientCountry.value();
  const currency = paymentCurrency.value() || "CHF";

  // Swiss QR Bill payload (SPC format)
  // See: https://www.paymentstandards.ch/dam/downloads/ig-qr-bill-en.pdf
  const lines = [
    "SPC",              // 1: QR type
    "0200",             // 2: Version
    "1",                // 3: Coding type (UTF-8)
    iban,               // 4: IBAN
    "S",                // 5: Creditor address type (structured)
    name,               // 6: Creditor name
    street,             // 7: Creditor street
    "",                 // 8: Creditor building number (optional)
    postalCode,         // 9: Creditor postal code
    city,               // 10: Creditor city
    country,            // 11: Creditor country
    "",                 // 12: Ultimate creditor address type
    "",                 // 13: Ultimate creditor name
    "",                 // 14: Ultimate creditor street
    "",                 // 15: Ultimate creditor building number
    "",                 // 16: Ultimate creditor postal code
    "",                 // 17: Ultimate creditor city
    "",                 // 18: Ultimate creditor country
    bill.amount.toFixed(2),  // 19: Amount
    currency,           // 20: Currency
    "",                 // 21: Debtor address type
    "",                 // 22: Debtor name
    "",                 // 23: Debtor street
    "",                 // 24: Debtor building number
    "",                 // 25: Debtor postal code
    "",                 // 26: Debtor city
    "",                 // 27: Debtor country
    "SCOR",             // 28: Reference type (Structured Creditor Reference)
    scorReference,      // 29: Reference
    "",                 // 30: Unstructured message
    "EPD",              // 31: Trailer
  ];

  return lines.join("\n");
}

export const getPaymentQrData = onCall(async (request) => {
  const { billId } = request.data as GetPaymentQrDataRequest;
  if (!billId || typeof billId !== "string") {
    throw new HttpsError("invalid-argument", "billId is required");
  }

  const db = getFirestore();
  const billDoc = await db.collection("bills").doc(billId).get();
  if (!billDoc.exists) {
    throw new HttpsError("not-found", `Bill ${billId} not found`);
  }

  const bill = billDoc.data() as BillEntity;

  // Generate SCOR reference from bill's reference number
  const scorReference = generateScorReference(
    String(bill.referenceNumber).padStart(9, "0"),
  );

  const qrPayload = buildQrPayload(bill, scorReference);

  // Load payer info from first checkout
  let payerName = "";
  const paylinkParams = new URLSearchParams();
  paylinkParams.set("amount.values", bill.amount.toFixed(2));
  paylinkParams.set("amount.custom", "false");
  paylinkParams.set("reference.creditor.value", scorReference);

  if (bill.checkouts.length > 0) {
    const checkoutDoc = await bill.checkouts[0].get();
    if (checkoutDoc.exists) {
      const checkout = checkoutDoc.data() as CheckoutEntity;
      const person = checkout.persons[0];
      if (person) {
        payerName = person.name;
        const nameParts = person.name.trim().split(/\s+/);
        const firstName = nameParts[0] ?? "";
        const lastName = nameParts.slice(1).join(" ") || firstName;
        paylinkParams.set("supporter.first_name.value", firstName);
        paylinkParams.set("supporter.last_name.value", lastName);
        if (person.email) {
          paylinkParams.set("supporter.email.value", person.email);
        }
      }
    }
  }

  const paylinkUrl = `${RAISENOW_PAYLINK_BASE_URL}/${raisenowPaylinkSolutionId.value()}?${paylinkParams.toString()}`;

  // Format IBAN with spaces for display (groups of 4)
  const ibanFormatted = paymentIban.value().replace(/\s/g, "").replace(/(.{4})/g, "$1 ").trim();

  return {
    qrBillPayload: qrPayload,
    paylinkUrl,
    // Structured fields for QR bill display
    creditor: {
      iban: ibanFormatted,
      name: paymentRecipientName.value(),
      street: paymentRecipientStreet.value(),
      location: `${paymentRecipientPostalCode.value()} ${paymentRecipientCity.value()}`,
    },
    reference: scorReference,
    payerName,
    amount: bill.amount.toFixed(2),
    currency: paymentCurrency.value() || "CHF",
  };
});
