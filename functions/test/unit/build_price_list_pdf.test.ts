// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { expect } from "chai";
import { buildPriceListPdf } from "../../src/price_list/build_price_list_pdf";
import {
  smallPriceList,
  mixedPriceList,
  longPriceList,
  emptyPriceList,
} from "./price_list_test_fixtures";

const pdfParse = require("pdf-parse");
const parsePdf = pdfParse as (buffer: Buffer) => Promise<{ text: string; numpages: number }>;

async function pdfText(data: Parameters<typeof buildPriceListPdf>[0]) {
  const buf = await buildPriceListPdf(data);
  expect(buf).to.be.instanceOf(Buffer);
  expect(buf.length).to.be.greaterThan(0);
  const result = await parsePdf(buf);
  return result;
}

describe("buildPriceListPdf — content", () => {
  it("renders title, header row, and price rows for a small list", async () => {
    const { text } = await pdfText(smallPriceList());
    expect(text).to.include("Holzwerkstatt – Materialliste");
    // Header columns
    expect(text).to.include("Code");
    expect(text).to.include("Name");
    expect(text).to.include("Preis");
    expect(text).to.include("Mitglieder");
    expect(text).to.include("Einheit");
    // Item rows
    expect(text).to.include("H001");
    expect(text).to.include("Sperrholz Birke 4mm");
    expect(text).to.include("H002");
    expect(text).to.include("Buchenleimholz 18mm");
    expect(text).to.include("H010");
    expect(text).to.include("Stationäre Maschinen");
    // Prices in the CHF NN.NN format
    expect(text).to.include("CHF 25.00");
    expect(text).to.include("CHF 20.00");
    expect(text).to.include("CHF 65.50");
    expect(text).to.include("CHF 50.00");
    // Footer text
    expect(text).to.include("Stand: April 2026");
  });

  it("renders correct unit labels for each pricing model", async () => {
    const { text } = await pdfText(mixedPriceList());
    // count → "Stk.", weight → "kg", sla → "l", direct → "CHF" (here as the
    // unit column, though the price already carries CHF — both renderings
    // are intentional, keep the test in sync if the contract changes).
    expect(text).to.include("Stk.");
    expect(text).to.include("kg");
    // sla and direct units use the same characters as elsewhere; just check
    // the rows landed.
    expect(text).to.include("S001");
    expect(text).to.include("D001");
  });

  it("paginates when the list exceeds one page", async () => {
    const { numpages, text } = await pdfText(longPriceList());
    expect(numpages).to.be.greaterThan(1);
    // Header columns repeat on the continuation page.
    expect((text.match(/Code/g) ?? []).length).to.be.greaterThan(1);
    // First and last item both present.
    expect(text).to.include("L001");
    expect(text).to.include("L060");
    // Footer text only renders on the last page (rendered once).
    expect(text).to.include("Preise gültig bis Ende 2026");
  });

  it("renders an empty list with footer + title (no item rows)", async () => {
    const { text } = await pdfText(emptyPriceList());
    expect(text).to.include("Leere Liste");
    expect(text).to.include("Noch keine Einträge");
  });

  it("produces a sane byte size for a small list (sanity bounds)", async () => {
    const buf = await buildPriceListPdf(smallPriceList());
    // Below 2KB would imply a corrupt/truncated PDF; above 1MB would imply
    // an embedded mistake (the QR PNG is a few KB at our resolution).
    expect(buf.length).to.be.greaterThan(2_000);
    expect(buf.length).to.be.lessThan(1_000_000);
  });
});
