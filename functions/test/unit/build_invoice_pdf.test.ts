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
} from "./invoice_test_fixtures";

// pdf-parse needs firebase-admin initialized for Timestamp usage in fixtures
if (getApps().length === 0) {
  initializeApp({ projectId: "test-project" });
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
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

  it("non-firma user: no billing address, shows name", async () => {
    const text = await pdfText(singleCheckoutInvoice());
    expect(text).to.include("Max Mustermann");
    expect(text).to.not.include("Industriestrasse");
  });

  it("with tip: Trinkgeld section present", async () => {
    const text = await pdfText(checkoutWithTipInvoice());
    expect(text).to.include("Trinkgeld");
    expect(text).to.include("5.00");
  });

  it("without tip: Trinkgeld section absent", async () => {
    const text = await pdfText(singleCheckoutInvoice());
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
    expect(text).to.include("725.30");
    // Payment terms (unpaid)
    expect(text).to.include("Zahlbar innert 30 Tagen");
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

  it("QR bill: creditor info present", async () => {
    const text = await pdfText(singleCheckoutInvoice());
    expect(text).to.include("Offene Werkstatt Wädenswil");
    // IBAN appears in QR bill payment part
    expect(text).to.include("CH93 0076 2011 6238 5295 7");
  });
});
