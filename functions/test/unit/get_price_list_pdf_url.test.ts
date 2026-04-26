// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { expect } from "chai";
import { buildPriceListContentHash } from "../../src/price_list/get_price_list_pdf_url";
import type { PriceListRenderData } from "../../src/price_list/types";

function base(): PriceListRenderData {
  return {
    name: "Test",
    footer: "Footer line",
    qrUrl: "https://example.com/list/abc",
    items: [
      {
        code: "A001",
        name: "Item One",
        pricingModel: "count",
        unitPrice: { none: 5, member: 4 },
      },
    ],
  };
}

describe("buildPriceListContentHash", () => {
  it("returns the same hash for identical input", () => {
    expect(buildPriceListContentHash(base())).to.equal(
      buildPriceListContentHash(base())
    );
  });

  it("changes when the price list name changes", () => {
    const a = buildPriceListContentHash(base());
    const data = base();
    data.name = "Different name";
    expect(buildPriceListContentHash(data)).to.not.equal(a);
  });

  it("changes when the footer text changes", () => {
    const a = buildPriceListContentHash(base());
    const data = base();
    data.footer = "Updated footer";
    expect(buildPriceListContentHash(data)).to.not.equal(a);
  });

  it("changes when an item's price changes", () => {
    const a = buildPriceListContentHash(base());
    const data = base();
    data.items[0].unitPrice = { none: 6, member: 4 };
    expect(buildPriceListContentHash(data)).to.not.equal(a);
  });

  it("changes when items are reordered (order matters)", () => {
    const data = base();
    data.items.push({
      code: "B002",
      name: "Item Two",
      pricingModel: "count",
      unitPrice: { none: 3, member: 2 },
    });
    const reversed = { ...data, items: [...data.items].reverse() };
    expect(buildPriceListContentHash(data)).to.not.equal(
      buildPriceListContentHash(reversed)
    );
  });

  it("returns a 16-char hex string", () => {
    const h = buildPriceListContentHash(base());
    expect(h).to.match(/^[0-9a-f]{16}$/);
  });
});
