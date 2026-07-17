// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { expect } from "chai";
import {
  PriceListDeriveError,
  derivePriceListRenderData,
  type PriceListSourceItem,
} from "../../src/price_list/derive_render_data";

const OPTS = {
  qrUrl: "https://checkout.example.com/visit/add/list/x",
  stand: "14.07.2026",
};

function item(
  overrides: Partial<PriceListSourceItem> = {},
): PriceListSourceItem {
  return {
    code: "3001",
    name: "Ahorn 24 mm",
    labelName: "Ahorn",
    labelMass: "24 mm",
    workshops: ["holz"],
    category: ["Massivholz"],
    variants: [
      { pricingModel: "area", unitPrice: { default: 62.3, member: 55 } },
    ],
    ...overrides,
  };
}

describe("derivePriceListRenderData", () => {
  it("derives title, color, and one table per category", () => {
    const data = derivePriceListRenderData(
      [
        item(),
        item({
          code: "3156",
          labelName: "3-Schichtplatte",
          category: ["Holzplatten"],
        }),
      ],
      OPTS,
    );
    // Two categories with nothing in common → workshop name as title.
    expect(data.title).to.equal("Holz");
    expect(data.color).to.equal("#ffde80");
    expect(data.stand).to.equal("14.07.2026");
    expect(data.categories.map((c) => c.name)).to.deep.equal([
      "Massivholz",
      "Holzplatten",
    ]);
    expect(data.categories.every((c) => c.showTitle)).to.equal(true);
  });

  it("uses the category name as title for single-category lists and suppresses its heading", () => {
    const data = derivePriceListRenderData(
      [
        item({
          code: "4216",
          labelName: "B128",
          workshops: ["keramik"],
          category: ["Tone"],
          variants: [{ pricingModel: "weight", unitPrice: { default: 3.25 } }],
        }),
        item({
          code: "4217",
          labelName: "B128 CHF",
          workshops: ["keramik"],
          category: ["Tone"],
          variants: [{ pricingModel: "weight", unitPrice: { default: 3.55 } }],
        }),
      ],
      OPTS,
    );
    expect(data.title).to.equal("Tone");
    expect(data.color).to.equal("#f39a83");
    expect(data.categories).to.have.length(1);
    expect(data.categories[0].showTitle).to.equal(false);
    expect(data.categories[0].unit).to.equal("kg");
  });

  it("titles by the deepest common path element for nested categories", () => {
    const data = derivePriceListRenderData(
      [
        item({ code: "3156", category: ["Platten", "Sperrholz"] }),
        item({ code: "3160", category: ["Platten", "OSB"] }),
      ],
      OPTS,
    );
    expect(data.title).to.equal("Platten");
    expect(data.categories.map((c) => c.name)).to.deep.equal([
      "Sperrholz",
      "OSB",
    ]);
  });

  it("orders categories by their lowest code and rows by code (numeric-aware)", () => {
    const data = derivePriceListRenderData(
      [
        item({
          code: "3186",
          category: ["Rundstäbe"],
          variants: [{ pricingModel: "length", unitPrice: { default: 1.4 } }],
        }),
        item({ code: "3002", category: ["Massivholz"] }),
        item({ code: "3001", category: ["Massivholz"] }),
      ],
      OPTS,
    );
    expect(data.categories.map((c) => c.name)).to.deep.equal([
      "Massivholz",
      "Rundstäbe",
    ]);
    expect(data.categories[0].rows.map((r) => r.code)).to.deep.equal([
      "3001",
      "3002",
    ]);
    expect(data.categories[1].unit).to.equal("lfm");
  });

  it("formats prices with two decimals from the canonical variant", () => {
    const data = derivePriceListRenderData([item()], OPTS);
    expect(data.categories[0].rows[0]).to.deep.equal({
      code: "3001",
      produkt: "Ahorn",
      mass: "24 mm",
      preis: "62.30",
    });
  });

  it("falls back to the composed name when no label fields exist", () => {
    const data = derivePriceListRenderData(
      [item({ labelName: undefined, labelMass: undefined })],
      OPTS,
    );
    expect(data.categories[0].rows[0].produkt).to.equal("Ahorn 24 mm");
    expect(data.categories[0].rows[0].mass).to.equal("");
  });

  it("resolves a shared workshop when items are multi-tagged", () => {
    const data = derivePriceListRenderData(
      [
        item({ workshops: ["holz", "makerspace"] }),
        item({ code: "3002", workshops: ["holz"] }),
      ],
      OPTS,
    );
    expect(data.color).to.equal("#ffde80");
  });

  it("throws for lists mixing workshops", () => {
    expect(() =>
      derivePriceListRenderData(
        [item(), item({ code: "2001", workshops: ["metall"] })],
        OPTS,
      ),
    )
      .to.throw(PriceListDeriveError, /mixes items/)
      .with.property("reason", "mixed-workshops");
  });

  it("throws for empty lists", () => {
    expect(() => derivePriceListRenderData([], OPTS))
      .to.throw(PriceListDeriveError)
      .with.property("reason", "empty");
  });

  it("throws when no item carries a workshop tag", () => {
    expect(() => derivePriceListRenderData([item({ workshops: [] })], OPTS))
      .to.throw(PriceListDeriveError)
      .with.property("reason", "no-workshop");
  });

  it("reports unrecognized workshop tags as broken data, not mixing", () => {
    expect(() =>
      derivePriceListRenderData(
        [item(), item({ code: "3002", workshops: ["holzz"] })],
        OPTS,
      ),
    )
      .to.throw(PriceListDeriveError, /3002.*holzz/)
      .with.property("reason", "unknown-workshop");
  });
});
