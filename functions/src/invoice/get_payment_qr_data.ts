// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Callable function: returns a complete Swiss QR Bill payload string for a bill.
 *
 * The client renders this string directly as a QR code — no payment config
 * (IBAN, recipient, TWINT params) is needed on the frontend.
 */

import { HttpsError, onCall } from "firebase-functions/v2/https";
import { defineString } from "firebase-functions/params";
import { getFirestore } from "firebase-admin/firestore";
import { generateScorReference } from "./scor_reference";
import type { BillEntity } from "./types";

// Payment config from environment params
const paymentIban = defineString("PAYMENT_IBAN");
const paymentRecipientName = defineString("PAYMENT_RECIPIENT_NAME");
const paymentRecipientPostalCode = defineString("PAYMENT_RECIPIENT_POSTAL_CODE");
const paymentRecipientCity = defineString("PAYMENT_RECIPIENT_CITY");
const paymentRecipientCountry = defineString("PAYMENT_RECIPIENT_COUNTRY");
const paymentCurrency = defineString("PAYMENT_CURRENCY");

// TWINT alternative scheme parameters (from RaiseNow Hub)
const twintAv1 = defineString("TWINT_AV1", { default: "" });
const twintAv2 = defineString("TWINT_AV2", { default: "" });

interface GetPaymentQrDataRequest {
  billId: string;
}

/**
 * Build the Swiss QR Bill payload string (SPC format).
 *
 * Lines 1-32 follow the Swiss Payment Standards spec, lines 33-34 are
 * optional alternative scheme parameters (used for TWINT).
 */
function buildQrPayload(bill: BillEntity, scorReference: string): string {
  const iban = paymentIban.value().replace(/\s/g, "");
  const name = paymentRecipientName.value();
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
    "",                 // 7: Creditor street (optional)
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

  // Lines 32-34: billing info + alternative schemes (optional)
  const av1Val = twintAv1.value();
  const av2Val = twintAv2.value();
  if (av1Val || av2Val) {
    lines.push("");     // 32: Billing information (empty)
    if (av1Val) lines.push(av1Val);  // 33: Alternative scheme 1
    if (av2Val) lines.push(av2Val);  // 34: Alternative scheme 2
  }

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

  return { qrPayload };
});
