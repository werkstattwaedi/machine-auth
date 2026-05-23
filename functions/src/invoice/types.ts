// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { DocumentReference, Timestamp } from "firebase-admin/firestore";
import { CheckoutPersonEntity, CheckoutItemEntity, UsageType } from "../types/firestore_entities";

export interface BillEntity {
  userId: DocumentReference;
  checkouts: DocumentReference[];
  referenceNumber: number;
  amount: number;
  currency: string;
  storagePath: string | null;
  created: Timestamp;
  paidAt: Timestamp | null;
  paidVia: "twint" | "ebanking" | "cash" | "free" | null;
  pdfGeneratedAt: Timestamp | null;
  emailSentAt: Timestamp | null;
  // The customer-stated "I'll pay this" ack. Server-only — written by
  // the acknowledgeBill callable (source: "user") or the
  // autoAcknowledgeBills cron (source: "auto"). The email and
  // membership-activation triggers key off this transitioning from null
  // to set.
  paymentMethodConfirmationTime: Timestamp | null;
  paymentMethodConfirmationSource: "user" | "auto" | null;
}

/** Per-person entry fee for display on the invoice */
export interface PersonEntryFee {
  name: string;
  userType: string;
  fee: number;
}

/** Assembled data for a single checkout within an invoice */
export interface InvoiceCheckout {
  date: Date;
  usageType: UsageType;
  persons: CheckoutPersonEntity[];
  personEntryFees: PersonEntryFee[];
  items: CheckoutItemEntity[];
  workshopsVisited: string[];
  entryFees: number;
  machineCost: number;
  materialCost: number;
  tip: number;
  totalPrice: number;
}

/** Workshop display info from config/pricing */
export interface WorkshopInfo {
  label: string;
  order: number;
}

/** Full data needed to render an invoice PDF */
export interface InvoiceData {
  referenceNumber: number;
  invoiceDate: Date;
  /**
   * Postal address rendered in the top-left recipient block (Swiss invoice
   * convention). When `company` is empty the company line is skipped — for a
   * registered (logged-in) non-firma user we render their `recipientName`
   * plus street/zip/city. For a firma checkout `company` carries the
   * company name and identifies the recipient.
   */
  billingAddress: {
    company: string;
    street: string;
    zip: string;
    city: string;
  } | null;
  recipientName: string;
  checkouts: InvoiceCheckout[];
  workshops: Record<string, WorkshopInfo>;
  grandTotal: number;
  currency: string;
  paidAt?: Date | null;
  paidVia?: "twint" | "ebanking" | "cash" | "free" | null;
  /**
   * Customer's chosen payment method from Step 4 (Bezahlen). Null at
   * bill-create time (PDF generated before the user picks). Set after
   * `acknowledgeBill` lands and the PDF is regenerated. Gates the QR
   * payment slip: only rendered for `rechnung` or null — TWINT /
   * Sammelrechnung get a method-specific notice instead, so users
   * don't think they need to pay via QR after already settling via
   * TWINT or having it routed to their monthly bill.
   */
  paymentMethod?: "rechnung" | "twint" | "monthly" | null;
}

/** Format a numeric reference number for display, e.g. 1 → "RE-000001" */
export function formatInvoiceNumber(n: number): string {
  return `RE-${String(n).padStart(6, "0")}`;
}

/** Payment recipient configuration (from environment params) */
export interface PaymentConfig {
  iban: string;
  recipientName: string;
  recipientStreet: string;
  recipientPostalCode: string;
  recipientCity: string;
  recipientCountry: string;
  currency: string;
}
