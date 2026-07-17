// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { expect } from "chai";
import { buildPriceListContentHash } from "../../src/price_list/get_price_list_pdf_url";
import type { PriceListRenderData } from "../../src/price_list/types";

function base(): PriceListRenderData {
  return {
    title: "Holz",
    color: "#ffde80",
    stand: "14.07.2026",
    qrUrl: "https://example.com/visit/add/list/abc",
    categories: [
      {
        name: "Massivholz",
        showTitle: true,
        unit: "m²",
        rows: [
          { code: "3001", produkt: "Ahorn", mass: "24 mm", preis: "62.30" },
        ],
      },
    ],
  };
}

describe("buildPriceListContentHash", () => {
  it("returns the same hash for identical input", () => {
    expect(buildPriceListContentHash(base())).to.equal(
      buildPriceListContentHash(base()),
    );
  });

  it("changes when the title changes", () => {
    const a = buildPriceListContentHash(base());
    const data = base();
    data.title = "Metall";
    expect(buildPriceListContentHash(data)).to.not.equal(a);
  });

  it("changes when the stand date changes", () => {
    const a = buildPriceListContentHash(base());
    const data = base();
    data.stand = "15.07.2026";
    expect(buildPriceListContentHash(data)).to.not.equal(a);
  });

  it("changes when a row's price changes", () => {
    const a = buildPriceListContentHash(base());
    const data = base();
    data.categories[0].rows[0].preis = "63.00";
    expect(buildPriceListContentHash(data)).to.not.equal(a);
  });

  it("changes when rows are reordered (order matters)", () => {
    const data = base();
    data.categories[0].rows.push({
      code: "3002",
      produkt: "Ahorn",
      mass: "30 mm",
      preis: "77.85",
    });
    const reversed = base();
    reversed.categories[0].rows = [...data.categories[0].rows].reverse();
    expect(buildPriceListContentHash(data)).to.not.equal(
      buildPriceListContentHash(reversed),
    );
  });

  it("returns a 16-char hex string", () => {
    const h = buildPriceListContentHash(base());
    expect(h).to.match(/^[0-9a-f]{16}$/);
  });
});
