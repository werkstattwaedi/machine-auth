// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { expect } from "chai";
import { initializeApp, getApps } from "firebase-admin/app";
import { buildInvoicePdf } from "../../src/invoice/build_invoice_pdf";
import {
  TEST_PAYMENT_CONFIG,
  singleCheckoutInvoice,
  firmaCheckoutInvoice,
  multiCheckoutInvoice,
  checkoutWithTipInvoice,
  zeroItemsInvoice,
  longInvoice,
  paidInvoice,
  twintMethodInvoice,
  freeZeroAmountInvoice,
  registeredUserInvoice,
  membershipOnlyInvoice,
  membershipMixedInvoice,
} from "./invoice_test_fixtures";

// pdf-parse needs firebase-admin initialized for Timestamp usage in fixtures
if (getApps().length === 0) {
  initializeApp({ projectId: "test-project" });
}

const pdfParse = require("pdf-parse");
const parsePdf = pdfParse as (buffer: Buffer) => Promise<{ text: string }>;

async function pdfText(data: Parameters<typeof buildInvoicePdf>[0]): Promise<string> {
  const buf = await buildInvoicePdf(data, TEST_PAYMENT_CONFIG);
  expect(buf).to.be.instanceOf(Buffer);
  expect(buf.length).to.be.greaterThan(0);
  const result = await parsePdf(buf);
  return result.text;
}

describe("buildInvoicePdf — content", () => {
  it("single checkout: reference number, date, person, items, total", async () => {
    const text = await pdfText(singleCheckoutInvoice());
    expect(text).to.include("Rechnung Self Checkout");
    expect(text).to.include("Rechnungsnummer: RE-000001");
    // SCOR reference in QR bill section (space-separated per spec)
    expect(text).to.include("RF74 0000 0000 1");
    expect(text).to.include("15.06.2025");
    expect(text).to.include("14.06.2025 14:30");
    expect(text).to.include("Max Mustermann");
    expect(text).to.include("Stationäre Maschinen");
    expect(text).to.include("Sperrholz Birke 4mm");
    expect(text).to.include("Holzwerkstatt");
    expect(text).to.include("52.50");
    expect(text).to.include("keine MWST");
    // Sender address from payment config
    expect(text).to.include("Seestrasse 109");
    expect(text).to.include("8820 Wädenswil");
    // Itemized columns: unit, quantity, and unit price present
    expect(text).to.include("50.00");  // unit price for Stationäre Maschinen (50 CHF/h)
    expect(text).to.include("0.50");   // quantity (0.5 h)
    // Issue #269: replaced the verbose "Preise inkl. Material, exkl. MWST
    // (keine MWST)" line with the shorter "keine MWST" notice.
    expect(text).to.not.include("Preise inkl. Material");
    expect(text).to.not.include("exkl. MWST");
  });

  it("multi-checkout: multiple visit date headers", async () => {
    const text = await pdfText(multiCheckoutInvoice());
    expect(text).to.include("20.06.2025 10:00");
    expect(text).to.include("27.06.2025 14:00");
    expect(text).to.include("Holzwerkstatt");
    expect(text).to.include("Metallwerkstatt");
    expect(text).to.include("93.00");
  });

  it("firma user: billing address appears", async () => {
    const text = await pdfText(firmaCheckoutInvoice());
    expect(text).to.include("Muster AG");
    expect(text).to.include("Industriestrasse 42");
    expect(text).to.include("8001 Zürich");
  });

  // Issue #269 review: anonymous walk-ins (no billingAddress) render NO
  // recipient block above the title — the person is identified by the
  // Nutzungsgebühren table instead. zeroItemsInvoice is the explicit
  // anonymous-walk-in fixture; the other registered-user fixtures now
  // carry a billingAddress.
  it("anonymous walk-in: name appears only in Nutzungsgebühren, no recipient block (#269)", async () => {
    const text = await pdfText(zeroItemsInvoice());
    expect(text).to.include("Erika Nur-Eintritt");
    // No street block at the top — anonymous fixture has no billingAddress.
    expect(text).to.not.include("Industriestrasse");
  });

  it("registered user (singleCheckout): full address block present (#269)", async () => {
    const text = await pdfText(singleCheckoutInvoice());
    expect(text).to.include("Max Mustermann");
    expect(text).to.include("Lindenweg 12");
    expect(text).to.include("8820 Wädenswil");
  });

  it("with donation: Spende section present (issue #250)", async () => {
    const text = await pdfText(checkoutWithTipInvoice());
    // Per issue #250 the line label is now "Spende"; the field is still
    // named `tip` for back-compat with already-issued bills.
    expect(text).to.include("Spende");
    expect(text).to.include("5.00");
    expect(text).to.not.include("Trinkgeld");
  });

  it("without donation: Spende section absent", async () => {
    const text = await pdfText(singleCheckoutInvoice());
    expect(text).to.not.include("Spende");
    expect(text).to.not.include("Trinkgeld");
  });

  it("zero items: only entry fees shown", async () => {
    const text = await pdfText(zeroItemsInvoice());
    expect(text).to.include("Nutzungsgebühren");
    expect(text).to.include("Erika Nur-Eintritt");
    expect(text).to.include("15.00");
  });

  it("long invoice: all pricing models present", async () => {
    const text = await pdfText(longInvoice());
    // All three workshops
    expect(text).to.include("Holzwerkstatt");
    expect(text).to.include("Metallwerkstatt");
    expect(text).to.include("Makerspace");
    // Three visit dates
    expect(text).to.include("01.08.2025 08:30");
    expect(text).to.include("08.08.2025 13:00");
    expect(text).to.include("12.08.2025 10:00");
    // Grand total
    expect(text).to.include("747.80");
    // SLA row renders the two input axes inline in the description instead
    // of the misleading quantity × unitPrice columns (see build_invoice_pdf
    // SLA special-case).
    expect(text).to.include("SLA Resin (Tough) (50 ml · 1000 layers)");
    // Payment terms (unpaid)
    expect(text).to.include("Zahlbar innert 30 Tagen");
  });

  // Issue #237: zero-amount bills ("Interne Nutzung") are recorded for the
  // books but have no payable balance. The PDF must keep a record of the
  // visit, replace the QR-bill section with a "Keine Zahlung erforderlich"
  // notice, and not include the QR-bill payment slip (Empfangsschein /
  // Zahlteil from swissqrbill).
  it("free zero-amount invoice: no QR bill, shows 'Keine Zahlung erforderlich' (#237)", async () => {
    const text = await pdfText(freeZeroAmountInvoice());
    expect(text).to.include("Keine Zahlung erforderlich");
    expect(text).to.include("CHF 0.00");
    // QR-bill payment slip must NOT be rendered.
    expect(text).to.not.include("Empfangsschein");
    expect(text).to.not.include("Zahlteil");
    // Regular "Zahlbar innert 30 Tagen" terms also gone — nothing to pay.
    expect(text).to.not.include("Zahlbar innert 30 Tagen");
    // Should NOT show the "Bezahlt via …" notice — that's for an
    // explicitly-paid bill, not a free one.
    expect(text).to.not.include("bereits beglichen");
  });

  // Issue #269: even when the entry fee is 0 (e.g. interne Nutzung,
  // materialbezug) the Nutzungsgebühren table must still list the person
  // so the bill recipient is identifiable.
  it("zero entry fee: Nutzungsgebühren table still lists the person (#269)", async () => {
    const text = await pdfText(freeZeroAmountInvoice());
    expect(text).to.include("Nutzungsgebühren");
    expect(text).to.include("Ines Intern");
    expect(text).to.include("Erwachsen");
  });

  // Issue #269: a registered (logged-in) non-firma user with a stored
  // billingAddress gets a full address block where their name used to be.
  it("registered user with address: renders full postal address block (#269)", async () => {
    const text = await pdfText(registeredUserInvoice());
    // Person name is the first line of the recipient block.
    expect(text).to.include("Mike Schneider");
    // Street + zip/city present from user-doc billingAddress.
    expect(text).to.include("Bahnhofstrasse 7");
    expect(text).to.include("8820 Wädenswil");
  });

  // Issue #269 review: logged-in user's name+address must pre-fill the QR
  // bill's "Zahlbar durch" section. Anonymous walk-ins keep the empty
  // handwriting box (no debtor field on the Swiss QR bill).
  it("registered user: QR bill debtor (Zahlbar durch) is pre-filled (#269)", async () => {
    const text = await pdfText(registeredUserInvoice());
    // Street appears in BOTH the recipient block AND the QR debtor section.
    // Two occurrences proves the debtor was populated (recipient block
    // alone would give exactly one).
    const streetMatches = text.split("Bahnhofstrasse 7").length - 1;
    expect(
      streetMatches,
      "Bahnhofstrasse 7 must appear in both the recipient block and the QR debtor",
    ).to.be.greaterThan(1);
  });

  it("anonymous walk-in: QR bill debtor is omitted (empty Zahlbar durch box) (#269)", async () => {
    // zeroItemsInvoice has no billingAddress and no paidAt → unpaid branch
    // renders the QR bill. The debtor field must NOT be set so the printed
    // QR bill leaves the "Zahlbar durch" box empty for handwriting.
    const text = await pdfText(zeroItemsInvoice());
    // Erika appears in the Nutzungsgebühren table — exactly once. If we
    // accidentally populated the debtor with the recipientName, she'd
    // show up a second time.
    const nameMatches = text.split("Erika Nur-Eintritt").length - 1;
    expect(
      nameMatches,
      "Erika should appear only in Nutzungsgebühren, not as QR debtor",
    ).to.equal(1);
  });

  it("paid invoice: no QR bill, shows payment confirmation", async () => {
    const text = await pdfText(paidInvoice());
    expect(text).to.include("Bezahlt via TWINT am 16.06.2025");
    expect(text).to.include("bereits beglichen");
    // Should NOT contain payment slip elements
    expect(text).to.not.include("Empfangsschein");
    expect(text).to.not.include("Zahlteil");
  });

  it("unpaid invoice: shows payment terms", async () => {
    const text = await pdfText(singleCheckoutInvoice());
    expect(text).to.include("Zahlbar innert 30 Tagen");
  });

  // Issue #426: a TWINT-method self-checkout is a payment receipt, not a
  // payable Rechnung. The PDF must (a) title itself "Quittung Self
  // Checkout" so the customer sees it's a TWINT receipt (matching the
  // "Quittung TWINT-Zahlung" email), (b) state the TWINT payment method,
  // and (c) omit the QR payment slip so nobody pays twice. It must NOT
  // claim "Bezahlt am …" — we have no bank-side confirmation.
  it("TWINT-method invoice: 'Quittung' title, TWINT notice, no QR slip (#426)", async () => {
    const text = await pdfText(twintMethodInvoice());
    expect(text).to.include("Quittung Self Checkout");
    expect(text).to.not.include("Rechnung Self Checkout");
    // The underlying bill is still kind "invoice" → RE- reference kept.
    expect(text).to.include("Rechnungsnummer: RE-000010");
    // States the payment method.
    expect(text).to.include("Zahlweise: TWINT");
    // No QR payment slip and no "pay within 30 days" terms.
    expect(text).to.not.include("Empfangsschein");
    expect(text).to.not.include("Zahlteil");
    expect(text).to.not.include("Zahlbar innert 30 Tagen");
    // Must not falsely claim a confirmed payment — no bank confirmation.
    expect(text).to.not.include("Bezahlt via TWINT am");
    expect(text).to.not.include("bereits beglichen");
  });

  it("QR bill: creditor info present", async () => {
    const text = await pdfText(singleCheckoutInvoice());
    expect(text).to.include("Offene Werkstatt Wädenswil");
    // IBAN appears in QR bill payment part
    expect(text).to.include("CH93 0076 2011 6238 5295 7");
  });

  // Issue #262: a membership-only bill renders a dedicated "Mitgliedschaft"
  // heading and no "Diverses" workshop group.
  it("membership-only: Mitgliedschaft heading present, no Diverses group", async () => {
    const text = await pdfText(membershipOnlyInvoice());
    expect(text).to.include("Mitgliedschaft");
    expect(text).to.include("Mitgliedschaft — Einzel");
    expect(text).to.include("80.00");
    // The legacy "diverses" workshop heading must NOT appear — that was the
    // confusing rendering Marco reported.
    expect(text).to.not.include("Diverses");
    expect(text).to.not.include("diverses");
  });

  // Issue #262/#263 (PR #347 review): a membership-only bill (membership item,
  // no other items, entryFees 0) omits the Nutzungsgebühren block entirely,
  // mirroring the checkout summary's `membershipOnly` view. The membership SKU
  // is not a workshop visit, so the zero-fee Nutzungsgebühren line read as noise.
  it("membership-only: Nutzungsgebühren block is omitted", async () => {
    const text = await pdfText(membershipOnlyInvoice());
    expect(text).to.not.include("Nutzungsgebühren");
    // The membership block itself must still be there (we only dropped the
    // entry-fees block, not the whole section).
    expect(text).to.include("Mitgliedschaft — Einzel");
  });

  // Issue #269 carve-out (must survive the #262/#263 membership-only change):
  // a NON-membership zero-fee bill (interne Nutzung, materialbezug without a
  // membership) must STILL render Nutzungsgebühren so the recipient is
  // identifiable. freeZeroAmountInvoice is interne Nutzung — entryFees 0, no
  // items, no membership SKU. If a future change broadens the membership-only
  // suppression to all zero-fee bills, this locks in the regression.
  it("non-membership zero-fee bill: Nutzungsgebühren still rendered (#269)", async () => {
    const text = await pdfText(freeZeroAmountInvoice());
    expect(text).to.include("Nutzungsgebühren");
    expect(text).to.include("Ines Intern");
  });

  // Issue #263: a mixed bill keeps membership in its own block and the
  // workshop material under the workshop group — membership never bleeds
  // into a Diverses heading.
  it("membership + workshop items: separate Mitgliedschaft + workshop groups, no Diverses", async () => {
    const text = await pdfText(membershipMixedInvoice());
    expect(text).to.include("Mitgliedschaft");
    expect(text).to.include("Mitgliedschaft — Einzel");
    expect(text).to.include("Holzwerkstatt");
    expect(text).to.include("Sperrholz Birke 4mm");
    expect(text).to.not.include("Diverses");
    expect(text).to.not.include("diverses");
  });
});

// Guards against regression where fixtures use `new Date(Y, M, D, h, m)`, which
// depends on the runner's local timezone. CI runs in UTC and dev machines in
// Europe/Zurich — a TZ-dependent fixture means `formatWorkshopDateTime` asserts
// pass locally but fail in CI (the bug that broke PR #133). Fixtures must pin
// each date to a concrete UTC instant.
describe("invoice fixtures — timezone independence", () => {
  it("single checkout fixture pins the visit date to a UTC instant", () => {
    // 14.06.2025 14:30 Europe/Zurich = CEST (UTC+2) = 12:30 UTC
    expect(singleCheckoutInvoice().checkouts[0].date.toISOString())
      .to.equal("2025-06-14T12:30:00.000Z");
  });

  it("long invoice fixture pins the first visit date to a UTC instant", () => {
    // 01.08.2025 08:30 Europe/Zurich = CEST (UTC+2) = 06:30 UTC
    expect(longInvoice().checkouts[0].date.toISOString())
      .to.equal("2025-08-01T06:30:00.000Z");
  });
});
