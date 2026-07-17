// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { expect } from "chai";
import { buildPriceListPdf } from "../../src/price_list/build_price_list_pdf";
import {
  holzPriceList,
  metallPriceList,
  keramikPriceList,
  longSingleCategoryPriceList,
} from "./price_list_test_fixtures";

const pdfParse = require("pdf-parse");
const parsePdf = pdfParse as (
  buffer: Buffer,
) => Promise<{ text: string; numpages: number }>;

async function pdfText(data: Parameters<typeof buildPriceListPdf>[0]) {
  const buf = await buildPriceListPdf(data);
  expect(buf).to.be.instanceOf(Buffer);
  expect(buf.length).to.be.greaterThan(0);
  const result = await parsePdf(buf);
  return result;
}

/** Extract text per page (pdf-parse's default output concatenates pages). */
async function pdfPageTexts(buf: Buffer): Promise<string[]> {
  const pages: string[] = [];
  await (pdfParse as any)(buf, {
    pagerender: async (pageData: any) => {
      const content = await pageData.getTextContent();
      const text = content.items
        .map((item: { str: string }) => item.str)
        .join(" ");
      pages.push(text);
      return text;
    },
  });
  return pages;
}

describe("buildPriceListPdf — content", () => {
  it("renders kicker, title, category headings and rows", async () => {
    // 5 categories à ~131pt don't fit one page — the 5th block moves whole
    // to page 2 (break-inside: avoid), same as the CSS reference.
    const { text, numpages } = await pdfText(holzPriceList());
    expect(numpages).to.equal(2);
    expect(text).to.include("PREISLISTE");
    expect(text).to.include("Holz");
    // Category headings
    expect(text).to.include("Massivholz");
    expect(text).to.include("Holzplatten");
    expect(text).to.include("Rundstäbe");
    expect(text).to.include("Schleifmittel");
    expect(text).to.include("Holzverbinder und Kleinteile");
    // Column headers carry the per-category unit
    expect(text).to.include("Preis CHF/m²");
    expect(text).to.include("Preis CHF/lfm");
    expect(text).to.include("Preis CHF/Stk");
    // Rows: code, produkt, mass, price (two decimals, no CHF prefix)
    expect(text).to.include("3001");
    expect(text).to.include("Ahorn");
    expect(text).to.include("24 mm");
    expect(text).to.include("62.30");
    expect(text).to.include("129.75");
    // QR caption + footer
    // The caption wraps, so assert per-line fragments.
    expect(text).to.include("Scannen, um Material");
    expect(text).to.include("hinzuzufügen");
    expect(text).to.include("Stand: 14.07.2026");
    expect(text).to.include("Offene Werkstatt Wädenswil");
  });

  it("suppresses the table heading when it equals the title", async () => {
    const { text } = await pdfText(keramikPriceList());
    // "Tone" appears exactly once — as the page title, not again as h2.
    expect((text.match(/Tone/g) ?? []).length).to.equal(1);
    expect(text).to.include("Preis CHF/kg");
    // No row has a mass → the floating "Mass" column header is dropped.
    expect(text).to.not.include("Mass");
  });

  it("substitutes glyphs the fonts lack (⌀ → Ø)", async () => {
    const fixture = keramikPriceList();
    fixture.categories[0].rows[0].mass = "⌀ 100 mm";
    const { text } = await pdfText(fixture);
    expect(text).to.include("Ø 100 mm");
    expect(text).to.not.include("⌀");
    // A single row with mass is enough to bring the column header back.
    expect(text).to.include("Mass");
  });

  it("paginates multi-category lists and repeats the table head", async () => {
    const { numpages, text } = await pdfText(metallPriceList());
    expect(numpages).to.be.greaterThan(1);
    // All categories present.
    for (const heading of [
      "Flachstahl",
      "Rundstahl",
      "Vierkant- und Rechteckrohr",
      "Bleche",
      "Schweissen und Verbrauch",
    ]) {
      expect(text).to.include(heading);
    }
    // First and last rows land.
    expect(text).to.include("2001");
    expect(text).to.include("2093");
    // Footer repeats on every page.
    expect((text.match(/Offene Werkstatt Wädenswil/g) ?? []).length).to.equal(
      numpages,
    );
    // Multi-page lists carry stamped page numbers.
    expect(text).to.include(`Seite 1 von ${numpages}`);
    expect(text).to.include(`Seite ${numpages} von ${numpages}`);
  });

  it("splits a long category with repeated column headers", async () => {
    const { numpages, text } = await pdfText(longSingleCategoryPriceList());
    expect(numpages).to.be.greaterThan(1);
    // The column head repeats on each continuation page.
    expect((text.match(/Produkt/g) ?? []).length).to.equal(numpages);
    expect(text).to.include("5001");
    expect(text).to.include("5060");
  });

  it("never strands fewer than 3 rows on either side of a split", async function () {
    this.timeout(20000);
    // Row counts straddling the page-1 capacity, so at least one of them
    // would naively leave a 1–2 row widow on the continuation page.
    for (const rowCount of [24, 25, 26, 27, 60]) {
      const fixture = longSingleCategoryPriceList();
      fixture.categories[0].rows = fixture.categories[0].rows.slice(
        0,
        rowCount,
      );
      const buf = await buildPriceListPdf(fixture);
      const pages = await pdfPageTexts(buf);
      if (pages.length === 1) continue; // fits one page — nothing to check
      for (const [i, page] of pages.entries()) {
        const rowCodes = new Set(page.match(/5\d{3}/g) ?? []);
        expect(
          rowCodes.size,
          `page ${i + 1}/${pages.length} of ${rowCount}-row category has ${rowCodes.size} rows`,
        ).to.be.at.least(3);
      }
    }
  });

  it("produces a sane byte size (sanity bounds)", async () => {
    const buf = await buildPriceListPdf(holzPriceList());
    // Below 2KB would imply a corrupt/truncated PDF; above 1MB would imply
    // an embedding mistake (fonts subset to a few 10s of KB, QR is small).
    expect(buf.length).to.be.greaterThan(2_000);
    expect(buf.length).to.be.lessThan(1_000_000);
  });
});
