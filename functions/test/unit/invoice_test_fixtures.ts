// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import type { InvoiceData, PaymentConfig } from "../../src/invoice/types";
import type { CheckoutItemEntity } from "../../src/types/firestore_entities";
import { Timestamp } from "firebase-admin/firestore";

export const TEST_PAYMENT_CONFIG: PaymentConfig = {
  iban: "CH93 0076 2011 6238 5295 7",
  recipientName: "Offene Werkstatt Wädenswil",
  recipientStreet: "Seestrasse 109",
  recipientPostalCode: "8820",
  recipientCity: "Wädenswil",
  recipientCountry: "CH",
  currency: "CHF",
};

function makeItem(overrides: Partial<CheckoutItemEntity> & { description: string; workshop: string; totalPrice: number }): CheckoutItemEntity {
  return {
    origin: "manual",
    catalogId: null,
    created: Timestamp.now(),
    quantity: 1,
    unitPrice: overrides.totalPrice,
    ...overrides,
  } as CheckoutItemEntity;
}

export function singleCheckoutInvoice(): InvoiceData {
  return {
    referenceNumber: "RF32000000001",
    invoiceDate: new Date(2025, 5, 15),
    billingAddress: null,
    recipientName: "Max Mustermann",
    checkouts: [
      {
        date: new Date(2025, 5, 14, 14, 30),
        usageType: "regular",
        persons: [
          { name: "Max Mustermann", email: "max@example.com", userType: "erwachsen" },
        ],
        items: [
          makeItem({ description: "Stationäre Maschinen", workshop: "holz", totalPrice: 25 }),
          makeItem({ description: "Sperrholz Birke 4mm", workshop: "holz", totalPrice: 12.50 }),
        ],
        workshopsVisited: ["holz"],
        entryFees: 15,
        machineCost: 25,
        materialCost: 12.50,
        tip: 0,
        totalPrice: 52.50,
      },
    ],
    workshops: {
      holz: { label: "Holzwerkstatt", order: 1 },
      metall: { label: "Metallwerkstatt", order: 2 },
    },
    entryFeeLabels: { erwachsen: "Erwachsen", kind: "Kind (u. 18)", firma: "Firma" },
    grandTotal: 52.50,
    currency: "CHF",
  };
}

export function firmaCheckoutInvoice(): InvoiceData {
  return {
    referenceNumber: "RF18000000002",
    invoiceDate: new Date(2025, 6, 1),
    billingAddress: {
      company: "Muster AG",
      street: "Industriestrasse 42",
      zip: "8001",
      city: "Zürich",
    },
    recipientName: "Muster AG",
    checkouts: [
      {
        date: new Date(2025, 5, 28, 9, 0),
        usageType: "regular",
        persons: [
          {
            name: "Hans Firma",
            email: "hans@muster.ch",
            userType: "firma",
            billingAddress: { company: "Muster AG", street: "Industriestrasse 42", zip: "8001", city: "Zürich" },
          },
        ],
        items: [
          makeItem({ description: "CNC Fräse", workshop: "holz", totalPrice: 80 }),
        ],
        workshopsVisited: ["holz"],
        entryFees: 30,
        machineCost: 80,
        materialCost: 0,
        tip: 0,
        totalPrice: 110,
      },
    ],
    workshops: {
      holz: { label: "Holzwerkstatt", order: 1 },
    },
    entryFeeLabels: { erwachsen: "Erwachsen", kind: "Kind (u. 18)", firma: "Firma" },
    grandTotal: 110,
    currency: "CHF",
  };
}

export function multiCheckoutInvoice(): InvoiceData {
  return {
    referenceNumber: "RF45000000003",
    invoiceDate: new Date(2025, 6, 10),
    billingAddress: null,
    recipientName: "Lisa Beispiel",
    checkouts: [
      {
        date: new Date(2025, 5, 20, 10, 0),
        usageType: "regular",
        persons: [
          { name: "Lisa Beispiel", email: "lisa@example.com", userType: "erwachsen" },
        ],
        items: [
          makeItem({ description: "Stationäre Maschinen", workshop: "holz", totalPrice: 15 }),
        ],
        workshopsVisited: ["holz"],
        entryFees: 15,
        machineCost: 15,
        materialCost: 0,
        tip: 0,
        totalPrice: 30,
      },
      {
        date: new Date(2025, 5, 27, 14, 0),
        usageType: "regular",
        persons: [
          { name: "Lisa Beispiel", email: "lisa@example.com", userType: "erwachsen" },
        ],
        items: [
          makeItem({ description: "Schweissen", workshop: "metall", totalPrice: 40 }),
          makeItem({ description: "Stahl 2mm", workshop: "metall", totalPrice: 8 }),
        ],
        workshopsVisited: ["metall"],
        entryFees: 15,
        machineCost: 40,
        materialCost: 8,
        tip: 0,
        totalPrice: 63,
      },
    ],
    workshops: {
      holz: { label: "Holzwerkstatt", order: 1 },
      metall: { label: "Metallwerkstatt", order: 2 },
    },
    entryFeeLabels: { erwachsen: "Erwachsen", kind: "Kind (u. 18)", firma: "Firma" },
    grandTotal: 93,
    currency: "CHF",
  };
}

export function checkoutWithTipInvoice(): InvoiceData {
  const base = singleCheckoutInvoice();
  base.checkouts[0].tip = 5;
  base.checkouts[0].totalPrice = 57.50;
  base.grandTotal = 57.50;
  base.referenceNumber = "RF71000000004";
  return base;
}

export function zeroItemsInvoice(): InvoiceData {
  return {
    referenceNumber: "RF09000000005",
    invoiceDate: new Date(2025, 7, 1),
    billingAddress: null,
    recipientName: "Erika Nur-Eintritt",
    checkouts: [
      {
        date: new Date(2025, 6, 30, 16, 0),
        usageType: "regular",
        persons: [
          { name: "Erika Nur-Eintritt", email: "erika@example.com", userType: "erwachsen" },
        ],
        items: [],
        workshopsVisited: ["holz"],
        entryFees: 15,
        machineCost: 0,
        materialCost: 0,
        tip: 0,
        totalPrice: 15,
      },
    ],
    workshops: {
      holz: { label: "Holzwerkstatt", order: 1 },
    },
    entryFeeLabels: { erwachsen: "Erwachsen", kind: "Kind (u. 18)", firma: "Firma" },
    grandTotal: 15,
    currency: "CHF",
  };
}
