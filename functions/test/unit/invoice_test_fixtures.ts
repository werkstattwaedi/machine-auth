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
    // Convenience DEFAULT only: these fixtures' machine items are all
    // time-priced, so default type from pricingModel. Production does NOT
    // derive type from pricingModel — pass `type` explicitly in overrides
    // for any non-time machine (e.g. count-priced sandblasting). `...overrides`
    // is last, so an explicit `type` always wins (issue #105).
    type: overrides.pricingModel === "time" ? "machine" : "material",
    catalogId: null,
    created: Timestamp.now(),
    quantity: 1,
    unitPrice: overrides.totalPrice,
    ...overrides,
  } as CheckoutItemEntity;
}

/**
 * Issue #262/#263: the Vereinsmitgliedschaft catalog doc id used by the
 * membership invoice fixtures. The renderer (and the shared classifier)
 * match an item's `catalogId.id` against `InvoiceData.membershipCatalogId`.
 */
export const MEMBERSHIP_CATALOG_ID = "membership-sku-fixture";

/**
 * Build a membership-fee item. Mirrors `functions/src/membership/purchase.ts`:
 * the SKU is appended to the (legacy) `diverses` workshop and carries the
 * membership `catalogId`. We stub `catalogId` as a minimal `{ id }` object —
 * the classifier only reads `.id`, so a full DocumentReference isn't needed.
 */
function makeMembershipItem(
  description: string,
  totalPrice: number,
  variantId: "single" | "family" = "single",
): CheckoutItemEntity {
  return {
    origin: "manual",
    workshop: "diverses",
    description,
    catalogId: { id: MEMBERSHIP_CATALOG_ID },
    variantId,
    pricingModel: "direct",
    created: Timestamp.now(),
    quantity: 1,
    unitPrice: totalPrice,
    totalPrice,
  } as unknown as CheckoutItemEntity;
}

/**
 * Issue #262: a membership-only checkout (the visitor bought just a
 * membership). The bill shows a single "Mitgliedschaft" block — no workshop
 * groups, no "Diverses" heading. Entry fee is 0 (usageType "materialbezug").
 */
export function membershipOnlyInvoice(): InvoiceData {
  return {
    referenceNumber: 50,
    invoiceDate: zurich(2026, 4, 20),
    billingAddress: {
      company: "",
      street: "Vereinsweg 1",
      zip: "8820",
      city: "Wädenswil",
    },
    recipientName: "Marco Mitglied",
    membershipCatalogId: MEMBERSHIP_CATALOG_ID,
    checkouts: [
      {
        date: zurich(2026, 4, 19, 18, 0),
        usageType: "materialbezug",
        persons: [
          { name: "Marco Mitglied", email: "marco@example.com", userType: "erwachsen" },
        ],
        // RAW (standard) entry fee — bill_triggers computes personEntryFees
        // from the standard fee regardless of usage type (issue #284); the
        // materialbezug waiver lives in the discount multiplier. The
        // membership-only carve-out must key off the NET fee, so a non-zero
        // raw fee here is what guards that gate.
        personEntryFees: [{ name: "Marco Mitglied", userType: "erwachsen", fee: 15 }],
        items: [makeMembershipItem("Mitgliedschaft — Einzel", 80)],
        workshopsVisited: ["diverses"],
        entryFees: 15,
        machineCost: 0,
        materialCost: 80,
        tip: 0,
        totalPrice: 80,
      },
    ],
    workshops: {
      holz: { label: "Holzwerkstatt", order: 1 },
    },
    grandTotal: 80,
    currency: "CHF",
  };
}

/**
 * Issue #263: a mixed checkout — membership plus regular workshop material.
 * The bill shows the "Mitgliedschaft" block first, then the workshop group;
 * the membership must NOT bleed into a Diverses heading.
 */
export function membershipMixedInvoice(): InvoiceData {
  return {
    referenceNumber: 51,
    invoiceDate: zurich(2026, 4, 22),
    billingAddress: {
      company: "",
      street: "Vereinsweg 2",
      zip: "8820",
      city: "Wädenswil",
    },
    recipientName: "Nina Neu",
    membershipCatalogId: MEMBERSHIP_CATALOG_ID,
    checkouts: [
      {
        date: zurich(2026, 4, 21, 14, 0),
        usageType: "regular",
        persons: [
          { name: "Nina Neu", email: "nina@example.com", userType: "erwachsen" },
        ],
        personEntryFees: [{ name: "Nina Neu", userType: "erwachsen", fee: 15 }],
        items: [
          makeMembershipItem("Mitgliedschaft — Einzel", 80),
          makeItem({ description: "Sperrholz Birke 4mm", workshop: "holz", pricingModel: "area", quantity: 0.5, unitPrice: 25, totalPrice: 12.5 }),
          makeItem({ description: "Stationäre Maschinen", workshop: "holz", pricingModel: "time", quantity: 0.5, unitPrice: 50, totalPrice: 25 }),
        ],
        workshopsVisited: ["holz", "diverses"],
        entryFees: 15,
        machineCost: 0,
        // Server bundles membership into materialCost (recomputeSummary): 80 + 12.50 + 25 = 117.50.
        materialCost: 117.5,
        tip: 0,
        totalPrice: 132.5,
      },
    ],
    workshops: {
      holz: { label: "Holzwerkstatt", order: 1 },
    },
    grandTotal: 132.5,
    currency: "CHF",
  };
}

export function singleCheckoutInvoice(): InvoiceData {
  return {
    referenceNumber: 1,
    invoiceDate: zurich(2025, 5, 15),
    // Registered users carry a billingAddress on their user doc (issue
    // #269 review). Empty company → registered-user shape.
    billingAddress: {
      company: "",
      street: "Lindenweg 12",
      zip: "8820",
      city: "Wädenswil",
    },
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
    // Registered user with billingAddress (issue #269 review).
    billingAddress: {
      company: "",
      street: "Mühlebachstrasse 5",
      zip: "8810",
      city: "Horgen",
    },
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

/**
 * Issue #251: TWINT-method invoice. The customer selected TWINT in the
 * Bezahlen step, so the PDF shows a "Zahlweise: TWINT" notice and omits
 * the QR payment slip. paidVia stays null — we have no bank confirmation
 * at the point this PDF is regenerated.
 */
export function twintMethodInvoice(): InvoiceData {
  const base = singleCheckoutInvoice();
  base.referenceNumber = 10;
  base.paymentMethod = "twint";
  return base;
}

/**
 * Issue #251: Sammelrechnung-method invoice. The customer routed this
 * checkout onto their monthly bill, so the PDF shows a "Zahlweise:
 * Sammelrechnung" notice and omits the QR payment slip.
 */
export function monthlyMethodInvoice(): InvoiceData {
  const base = singleCheckoutInvoice();
  base.referenceNumber = 11;
  base.paymentMethod = "monthly";
  return base;
}

/**
 * Issue #245: per-visit Beleg (kind: "beleg"). Title reads "Beleg Self
 * Checkout", number label "Belegnummer: BL-XXXXXX", and the Sammelrechnung
 * notice replaces the QR payment slip.
 */
export function belegPerVisit(): InvoiceData {
  const base = singleCheckoutInvoice();
  base.referenceNumber = 42;
  base.paymentMethod = "monthly";
  base.kind = "beleg";
  return base;
}

/**
 * Issue #237: zero-amount "free" bill (e.g. Interne Nutzung).
 * paidVia="free" + grandTotal=0 — the PDF must show a "Keine Zahlung
 * erforderlich" notice and NO Swiss QR-bill payment slip.
 */
export function freeZeroAmountInvoice(): InvoiceData {
  const now = zurich(2025, 4, 12);
  return {
    referenceNumber: 8,
    invoiceDate: now,
    // Registered user with billingAddress (issue #269 review). Interne
    // Nutzung is normally booked by a known member, not an anonymous
    // walk-in — the address belongs on the bill.
    billingAddress: {
      company: "",
      street: "Schulhausstrasse 3",
      zip: "8810",
      city: "Horgen",
    },
    recipientName: "Ines Intern",
    checkouts: [
      {
        date: zurich(2025, 4, 12, 10, 0),
        usageType: "intern",
        persons: [
          { name: "Ines Intern", email: "ines@example.com", userType: "erwachsen" },
        ],
        // Intern usageType zeros entry fees server-side, so the per-person
        // line is rendered with fee=0.
        personEntryFees: [{ name: "Ines Intern", userType: "erwachsen", fee: 0 }],
        items: [],
        workshopsVisited: ["holz"],
        entryFees: 0,
        machineCost: 0,
        materialCost: 0,
        tip: 0,
        totalPrice: 0,
      },
    ],
    workshops: {
      holz: { label: "Holzwerkstatt", order: 1 },
    },
    grandTotal: 0,
    currency: "CHF",
    paidAt: now,
    paidVia: "free",
  };
}

/**
 * Issue #284: a Freiwilligengruppe (`volunteering`) checkout. Entry + machine
 * usage are waived (rendered raw with a per-section "wird nicht verrechnet"
 * discount line), but material is still billed — so the bill has a real
 * payable balance and renders the QR slip.
 */
export function volunteeringDiscountInvoice(): InvoiceData {
  return {
    referenceNumber: 50,
    invoiceDate: zurich(2025, 4, 20),
    billingAddress: {
      company: "",
      street: "Vereinsweg 4",
      zip: "8820",
      city: "Wädenswil",
    },
    recipientName: "Vera Freiwillig",
    checkouts: [
      {
        date: zurich(2025, 4, 19, 18, 0),
        usageType: "volunteering",
        persons: [
          { name: "Vera Freiwillig", email: "vera@example.com", userType: "erwachsen" },
        ],
        // RAW fee — the renderer waives it via the discount line (issue #284).
        personEntryFees: [{ name: "Vera Freiwillig", userType: "erwachsen", fee: 15 }],
        items: [
          // Machine usage — waived for volunteering.
          makeItem({ description: "Stationäre Maschinen", workshop: "holz", origin: "nfc", pricingModel: "time", quantity: 1, unitPrice: 25, totalPrice: 25 }),
          // Material — still billed.
          makeItem({ description: "Sperrholz Birke 4mm", workshop: "holz", pricingModel: "area", quantity: 0.4, unitPrice: 25, totalPrice: 10 }),
        ],
        workshopsVisited: ["holz"],
        // RAW section amounts.
        entryFees: 15,
        machineCost: 25,
        materialCost: 10,
        tip: 0,
        totalPrice: 10,
      },
    ],
    workshops: {
      holz: { label: "Holzwerkstatt", order: 1 },
    },
    // NET: only the 10 CHF material is payable.
    grandTotal: 10,
    currency: "CHF",
  };
}

/**
 * Issue #284: an `intern` checkout that DID consume material. Everything
 * but the tip is waived; the PDF renders the raw entry/machine/material
 * prices each with a "Interne Nutzung: … wird nicht verrechnet" discount
 * line, then a CHF 0.00 free-zero notice (no QR slip).
 */
export function internDiscountInvoice(): InvoiceData {
  const now = zurich(2025, 4, 12);
  return {
    referenceNumber: 51,
    invoiceDate: now,
    billingAddress: {
      company: "",
      street: "Schulhausstrasse 3",
      zip: "8810",
      city: "Horgen",
    },
    recipientName: "Ines Intern",
    checkouts: [
      {
        date: zurich(2025, 4, 12, 10, 0),
        usageType: "intern",
        persons: [
          { name: "Ines Intern", email: "ines@example.com", userType: "erwachsen" },
        ],
        personEntryFees: [{ name: "Ines Intern", userType: "erwachsen", fee: 15 }],
        items: [
          makeItem({ description: "Laser", workshop: "makerspace", origin: "nfc", pricingModel: "time", quantity: 0.5, unitPrice: 60, totalPrice: 30 }),
          makeItem({ description: "MDF 10mm", workshop: "makerspace", pricingModel: "area", quantity: 4, unitPrice: 11.25, totalPrice: 45 }),
        ],
        workshopsVisited: ["makerspace"],
        entryFees: 15,
        machineCost: 30,
        materialCost: 45,
        tip: 0,
        totalPrice: 0,
      },
    ],
    workshops: {
      makerspace: { label: "Maker Space", order: 1 },
    },
    grandTotal: 0,
    currency: "CHF",
    paidAt: now,
    paidVia: "free",
  };
}

/**
 * Issue #269: a registered (logged-in) non-firma user whose user doc
 * carries a `billingAddress`. The PDF renders the standard Swiss recipient
 * address block — person name on top, then street + zip/city — and no
 * blank company line.
 */
export function registeredUserInvoice(): InvoiceData {
  return {
    referenceNumber: 9,
    invoiceDate: zurich(2025, 4, 20),
    billingAddress: {
      // Empty company → PDF emits the recipientName instead of a blank line.
      company: "",
      street: "Bahnhofstrasse 7",
      zip: "8820",
      city: "Wädenswil",
    },
    recipientName: "Mike Schneider",
    checkouts: [
      {
        date: zurich(2025, 4, 19, 19, 55),
        usageType: "regular",
        persons: [
          { name: "Mike Schneider", email: "mike@example.com", userType: "erwachsen" },
        ],
        personEntryFees: [{ name: "Mike Schneider", userType: "erwachsen", fee: 15 }],
        items: [
          makeItem({ description: "Tischfräse", workshop: "holz", pricingModel: "time", quantity: 1, unitPrice: 25, totalPrice: 25 }),
        ],
        workshopsVisited: ["holz"],
        entryFees: 15,
        machineCost: 25,
        materialCost: 0,
        tip: 0,
        totalPrice: 40,
      },
    ],
    workshops: {
      holz: { label: "Holzwerkstatt", order: 1 },
    },
    grandTotal: 40,
    currency: "CHF",
  };
}

/**
 * Issue #269: deliberately the anonymous-walk-in coverage. `billingAddress`
 * stays null so the PDF renders no recipient block above the title (the name
 * appears only in the Nutzungsgebühren table) and the Swiss QR bill leaves
 * the "Zahlbar durch" debtor section as an empty handwriting box. All other
 * registered-user fixtures now carry a billingAddress per the PR #297 review.
 */
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
