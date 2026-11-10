// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * The payment data of a bill: the Swiss QR Bill payload and, when the
 * RaiseNow integration is enabled, its PayLink URL. The close callable
 * returns it with the closed checkout; the client renders the QR bill and
 * links to the PayLink. (The standalone `getPaymentQrData` callable that
 * also served it had no caller left and went with #854.)
 */

import { defineString } from "firebase-functions/params";
import { generateScorReference } from "./scor_reference";
import { isPaymentMethodEnabled } from "../payments/config";
import type { PaymentMethod } from "../types/firestore_entities";
import { buildRaisenowPaylinkUrl } from "../payments/raisenow";
import type { BillEntity } from "./types";

// Payment config from environment params
const paymentIban = defineString("PAYMENT_IBAN");
const paymentRecipientName = defineString("PAYMENT_RECIPIENT_NAME");
// Empty default is deliberate: per Swiss Payment Standards (QR-bill spec
// field 7), the creditor street/building is optional. Keeping the default
// avoids prompting in setups where the org doesn't publish a street
// address. (Issue #149: documented carve-out.)
const paymentRecipientStreet = defineString("PAYMENT_RECIPIENT_STREET", { default: "" });
const paymentRecipientPostalCode = defineString("PAYMENT_RECIPIENT_POSTAL_CODE");
const paymentRecipientCity = defineString("PAYMENT_RECIPIENT_CITY");
const paymentRecipientCountry = defineString("PAYMENT_RECIPIENT_COUNTRY");
const paymentCurrency = defineString("PAYMENT_CURRENCY");

export interface PaymentData {
  // Doc id of the underlying bill — lets the client wire follow-up
  // actions (PDF download, etc.) without fetching the checkout doc.
  billId: string;
  // Doc id of the checkout this payment was generated for. Lets the client
  // persist the user's last-selected payment method (`paymentMethod`)
  // on the checkout without an extra fetch — needed for the anonymous
  // flow where the checkout doc was created server-side and the client
  // never had its id.
  checkoutId: string | null;
  qrBillPayload: string;
  // RaiseNow PayLink — null when "raisenow" is switched off for every
  // client type (payments/config.ts).
  paylinkUrl: string | null;
  creditor: {
    iban: string;
    name: string;
    street: string;
    location: string;
  };
  reference: string;
  payerName: string;
  payerEmail: string;
  amount: string;
  currency: string;
  // Set by the close (issue #750): the method the bill is committed with,
  // null while it is unconfirmed or free. A repeated close answers with
  // the first committed method, not the one it asked for.
  paymentMethod?: PaymentMethod | null;
}

export interface PaymentPayer {
  name: string;
  email?: string;
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

/**
 * Assemble the payment data (QR payload + PayLink + display fields) for a bill.
 * Each integration contributes its own field; add new ones next to the
 * PayLink rather than inside the QR-bill code.
 * Pure with respect to Firestore — caller provides the already-loaded bill and
 * payer info, so this can run inside or outside a transaction.
 */
export function buildPaymentData(
  bill: BillEntity,
  payer: PaymentPayer | null,
  billId: string,
  checkoutId: string | null,
): PaymentData {
  const scorReference = generateScorReference(
    String(bill.referenceNumber).padStart(9, "0"),
  );

  const qrPayload = buildQrPayload(bill, scorReference);

  const paylinkUrl = isPaymentMethodEnabled("raisenow")
    ? buildRaisenowPaylinkUrl({ amount: bill.amount, scorReference, payer })
    : null;

  // Format IBAN with spaces for display (groups of 4)
  const ibanFormatted = paymentIban.value().replace(/\s/g, "").replace(/(.{4})/g, "$1 ").trim();

  return {
    billId,
    checkoutId,
    qrBillPayload: qrPayload,
    paylinkUrl,
    creditor: {
      iban: ibanFormatted,
      name: paymentRecipientName.value(),
      street: paymentRecipientStreet.value(),
      location: `${paymentRecipientPostalCode.value()} ${paymentRecipientCity.value()}`,
    },
    reference: scorReference,
    payerName: payer?.name ?? "",
    payerEmail: payer?.email ?? "",
    amount: bill.amount.toFixed(2),
    currency: paymentCurrency.value() || "CHF",
  };
}
