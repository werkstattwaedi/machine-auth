// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import type { InvoiceData, PaymentConfig } from "../../src/invoice/types";
import type { CheckoutItemEntity } from "../../src/types/firestore_entities";
import { Timestamp } from "firebase-admin/firestore";
import { fromZonedTime } from "date-fns-tz";

/**
 * Build a Date representing the given wall-clock time in Europe/Zurich.
 *
 * Fixtures must not depend on the test runner's local timezone — CI runs in
 * UTC while developer machines are often in Europe/Zurich. Using
 * `new Date(Y, M, D, h, m)` would produce different instants in those two
 * environments and break `formatWorkshopDateTime` assertions.
 */
function zurich(year: number, monthIndex: number, day: number, hour = 0, minute = 0): Date {
  const iso = `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
  return fromZonedTime(iso, "Europe/Zurich");
}

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
    referenceNumber: 1,
    invoiceDate: zurich(2025, 5, 15),
    billingAddress: null,
    recipientName: "Max Mustermann",
    checkouts: [
      {
        date: zurich(2025, 5, 14, 14, 30),
        usageType: "regular",
        persons: [
          { name: "Max Mustermann", email: "max@example.com", userType: "erwachsen" },
        ],
        personEntryFees: [{ name: "Max Mustermann", userType: "erwachsen", fee: 15 }],
        items: [
          makeItem({ description: "Stationäre Maschinen", workshop: "holz", pricingModel: "time", quantity: 0.5, unitPrice: 50, totalPrice: 25 }),
          makeItem({ description: "Sperrholz Birke 4mm", workshop: "holz", pricingModel: "area", quantity: 0.5, unitPrice: 25, totalPrice: 12.50 }),
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
    grandTotal: 52.50,
    currency: "CHF",
  };
}

export function firmaCheckoutInvoice(): InvoiceData {
  return {
    referenceNumber: 2,
    invoiceDate: zurich(2025, 6, 1),
    billingAddress: {
      company: "Muster AG",
      street: "Industriestrasse 42",
      zip: "8001",
      city: "Zürich",
    },
    recipientName: "Muster AG",
    checkouts: [
      {
        date: zurich(2025, 5, 28, 9, 0),
        usageType: "regular",
        persons: [
          {
            name: "Hans Firma",
            email: "hans@muster.ch",
            userType: "firma",
            billingAddress: { company: "Muster AG", street: "Industriestrasse 42", zip: "8001", city: "Zürich" },
          },
        ],
        personEntryFees: [{ name: "Hans Firma", userType: "firma", fee: 30 }],
        items: [
          makeItem({ description: "CNC Fräse", workshop: "holz", pricingModel: "time", quantity: 2, unitPrice: 40, totalPrice: 80 }),
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
    grandTotal: 110,
    currency: "CHF",
  };
}

export function multiCheckoutInvoice(): InvoiceData {
  return {
    referenceNumber: 3,
    invoiceDate: zurich(2025, 6, 10),
    billingAddress: null,
    recipientName: "Lisa Beispiel",
    checkouts: [
      {
        date: zurich(2025, 5, 20, 10, 0),
        usageType: "regular",
        persons: [
          { name: "Lisa Beispiel", email: "lisa@example.com", userType: "erwachsen" },
        ],
        personEntryFees: [{ name: "Lisa Beispiel", userType: "erwachsen", fee: 15 }],
        items: [
          makeItem({ description: "Stationäre Maschinen", workshop: "holz", pricingModel: "time", quantity: 0.25, unitPrice: 60, totalPrice: 15 }),
        ],
        workshopsVisited: ["holz"],
        entryFees: 15,
        machineCost: 15,
        materialCost: 0,
        tip: 0,
        totalPrice: 30,
      },
      {
        date: zurich(2025, 5, 27, 14, 0),
        usageType: "regular",
        persons: [
          { name: "Lisa Beispiel", email: "lisa@example.com", userType: "erwachsen" },
        ],
        personEntryFees: [{ name: "Lisa Beispiel", userType: "erwachsen", fee: 15 }],
        items: [
          makeItem({ description: "Schweissen", workshop: "metall", pricingModel: "time", quantity: 1, unitPrice: 40, totalPrice: 40 }),
          makeItem({ description: "Stahl 2mm", workshop: "metall", pricingModel: "weight", quantity: 2, unitPrice: 4, totalPrice: 8 }),
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
    grandTotal: 93,
    currency: "CHF",
  };
}

export function checkoutWithTipInvoice(): InvoiceData {
  const base = singleCheckoutInvoice();
  base.checkouts[0].tip = 5;
  base.checkouts[0].totalPrice = 57.50;
  base.grandTotal = 57.50;
  base.referenceNumber = 4;
  return base;
}

export function longInvoice(): InvoiceData {
  const workshops = {
    holz: { label: "Holzwerkstatt", order: 1 },
    metall: { label: "Metallwerkstatt", order: 2 },
    makerspace: { label: "Makerspace", order: 3 },
  };

  return {
    referenceNumber: 6,
    invoiceDate: zurich(2025, 7, 15),
    billingAddress: {
      company: "Schreinerei Müller GmbH",
      street: "Werkgasse 17",
      zip: "8820",
      city: "Wädenswil",
    },
    recipientName: "Schreinerei Müller GmbH",
    checkouts: [
      {
        date: zurich(2025, 7, 1, 8, 30),
        usageType: "regular",
        persons: [
          {
            name: "Peter Müller",
            email: "peter@schreinerei-mueller.ch",
            userType: "firma",
            billingAddress: { company: "Schreinerei Müller GmbH", street: "Werkgasse 17", zip: "8820", city: "Wädenswil" },
          },
          { name: "Anna Müller", email: "anna@schreinerei-mueller.ch", userType: "erwachsen" },
        ],
        personEntryFees: [
          { name: "Peter Müller", userType: "firma", fee: 30 },
          { name: "Anna Müller", userType: "erwachsen", fee: 15 },
        ],
        items: [
          // time
          makeItem({ description: "Stationäre Maschinen", workshop: "holz", pricingModel: "time", quantity: 3.5, unitPrice: 50, totalPrice: 175 }),
          makeItem({ description: "CNC Fräse", workshop: "holz", pricingModel: "time", quantity: 1.5, unitPrice: 40, totalPrice: 60 }),
          // area
          makeItem({ description: "Sperrholz Birke 4mm", workshop: "holz", pricingModel: "area", quantity: 2.4, unitPrice: 25, totalPrice: 60 }),
          makeItem({ description: "MDF 12mm", workshop: "holz", pricingModel: "area", quantity: 1.2, unitPrice: 35, totalPrice: 42 }),
          // length
          makeItem({ description: "Eichenleiste 20x40mm", workshop: "holz", pricingModel: "length", quantity: 6, unitPrice: 8.50, totalPrice: 51 }),
          // count
          makeItem({ description: "Schleifscheibe K120", workshop: "holz", pricingModel: "count", quantity: 3, unitPrice: 4.50, totalPrice: 13.50 }),
          makeItem({ description: "Holzdübel 8mm (50er)", workshop: "holz", pricingModel: "count", quantity: 2, unitPrice: 6, totalPrice: 12 }),
        ],
        workshopsVisited: ["holz"],
        entryFees: 45, // 30 firma + 15 erwachsen
        machineCost: 235,
        materialCost: 178.50,
        tip: 0,
        totalPrice: 458.50,
      },
      {
        date: zurich(2025, 7, 8, 13, 0),
        usageType: "regular",
        persons: [
          {
            name: "Peter Müller",
            email: "peter@schreinerei-mueller.ch",
            userType: "firma",
            billingAddress: { company: "Schreinerei Müller GmbH", street: "Werkgasse 17", zip: "8820", city: "Wädenswil" },
          },
        ],
        personEntryFees: [{ name: "Peter Müller", userType: "firma", fee: 30 }],
        items: [
          // time
          makeItem({ description: "Schweissplatz", workshop: "metall", pricingModel: "time", quantity: 2, unitPrice: 40, totalPrice: 80 }),
          // weight
          makeItem({ description: "Stahlblech 2mm", workshop: "metall", pricingModel: "weight", quantity: 4.5, unitPrice: 6, totalPrice: 27 }),
          makeItem({ description: "Schweissdraht 0.8mm", workshop: "metall", pricingModel: "weight", quantity: 0.5, unitPrice: 30, totalPrice: 15 }),
          // direct
          makeItem({ description: "Schutzgas Nachfüllung", workshop: "metall", pricingModel: "direct", quantity: 1, unitPrice: 15, totalPrice: 15 }),
        ],
        workshopsVisited: ["metall"],
        entryFees: 30,
        machineCost: 80,
        materialCost: 57,
        tip: 0,
        totalPrice: 167,
      },
      {
        date: zurich(2025, 7, 12, 10, 0),
        usageType: "regular",
        persons: [
          {
            name: "Peter Müller",
            email: "peter@schreinerei-mueller.ch",
            userType: "firma",
            billingAddress: { company: "Schreinerei Müller GmbH", street: "Werkgasse 17", zip: "8820", city: "Wädenswil" },
          },
        ],
        personEntryFees: [{ name: "Peter Müller", userType: "firma", fee: 30 }],
        items: [
          makeItem({ description: "Lasercutter", workshop: "makerspace", pricingModel: "time", quantity: 0.75, unitPrice: 60, totalPrice: 45 }),
          makeItem({ description: "Acrylglas 3mm transparent", workshop: "makerspace", pricingModel: "area", quantity: 0.3, unitPrice: 50, totalPrice: 15 }),
          makeItem({ description: "3D-Druck PLA", workshop: "makerspace", pricingModel: "weight", quantity: 0.12, unitPrice: 40, totalPrice: 4.80 }),
          // sla: 50ml resin @ 250 CHF/l + 1000 layers @ 0.01 CHF = 12.50 + 10.00 = 22.50.
          // formInputs carry the two input axes so the PDF can render the
          // full pricing signal; SLA quantity × unitPrice would otherwise
          // read as "1 × 250 = 22.50" which is arithmetically nonsense.
          makeItem({
            description: "SLA Resin (Tough)",
            workshop: "makerspace",
            pricingModel: "sla",
            quantity: 1,
            unitPrice: 250,
            totalPrice: 22.50,
            formInputs: [
              { quantity: 50, unit: "ml" },
              { quantity: 1000, unit: "layers" },
            ],
          }),
        ],
        workshopsVisited: ["makerspace"],
        entryFees: 30,
        machineCost: 45,
        materialCost: 42.30,
        tip: 5,
        totalPrice: 122.30,
      },
    ],
    workshops,
    grandTotal: 747.80,
    currency: "CHF",
  };
}

export function paidInvoice(): InvoiceData {
  const base = singleCheckoutInvoice();
  base.referenceNumber = 7;
  base.paidAt = zurich(2025, 5, 16);
  base.paidVia = "twint";
  return base;
}

export function zeroItemsInvoice(): InvoiceData {
  return {
    referenceNumber: 5,
    invoiceDate: zurich(2025, 7, 1),
    billingAddress: null,
    recipientName: "Erika Nur-Eintritt",
    checkouts: [
      {
        date: zurich(2025, 6, 30, 16, 0),
        usageType: "regular",
        persons: [
          { name: "Erika Nur-Eintritt", email: "erika@example.com", userType: "erwachsen" },
        ],
        personEntryFees: [{ name: "Erika Nur-Eintritt", userType: "erwachsen", fee: 15 }],
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
    grandTotal: 15,
    currency: "CHF",
  };
}
