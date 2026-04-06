// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { DocumentReference, Timestamp } from "firebase-admin/firestore";
import { CheckoutPersonEntity, CheckoutItemEntity, UsageType } from "../types/firestore_entities";

export interface BillEntity {
  userId: DocumentReference;
  checkouts: DocumentReference[];
  referenceNumber: string;
  amount: number;
  currency: string;
  storagePath: string | null;
  created: Timestamp;
  paidAt: Timestamp | null;
  paidVia: "twint" | "ebanking" | "cash" | null;
}

/** Assembled data for a single checkout within an invoice */
export interface InvoiceCheckout {
  date: Date;
  usageType: UsageType;
  persons: CheckoutPersonEntity[];
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
  referenceNumber: string;
  invoiceDate: Date;
  billingAddress: {
    company: string;
    street: string;
    zip: string;
    city: string;
  } | null;
  recipientName: string;
  checkouts: InvoiceCheckout[];
  workshops: Record<string, WorkshopInfo>;
  entryFeeLabels: Record<string, string>;
  grandTotal: number;
  currency: string;
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
