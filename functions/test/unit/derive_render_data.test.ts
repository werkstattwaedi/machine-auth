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
      { id: "default", pricingModel: "area", unitPrice: { default: 62.3, member: 55 } },
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
          variants: [{ id: "default", pricingModel: "weight", unitPrice: { default: 3.25 } }],
        }),
        item({
          code: "4217",
          labelName: "B128 CHF",
          workshops: ["keramik"],
          category: ["Tone"],
          variants: [{ id: "default", pricingModel: "weight", unitPrice: { default: 3.55 } }],
        }),
      ],
      OPTS,
    );
    expect(data.title).to.equal("Tone");
    expect(data.color).to.equal("#f39a83");
    expect(data.categories).to.have.length(1);
    expect(data.categories[0].showTitle).to.equal(false);
    expect(data.categories[0].priceColumns).to.deep.equal([{ heading: "pro kg" }]);
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
          variants: [{ id: "default", pricingModel: "length", unitPrice: { default: 1.4 } }],
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
    expect(data.categories[1].priceColumns).to.deep.equal([{ heading: "pro lfm" }]);
  });

  it("formats prices with two decimals from the canonical variant", () => {
    const data = derivePriceListRenderData([item()], OPTS);
    expect(data.categories[0].rows[0]).to.deep.equal({
      code: "3001",
      produkt: "Ahorn",
      mass: "24 mm",
      prices: ["62.30"],
    });
  });

  describe("price columns", () => {
    const m2 = (price: number) => ({
      id: "default",
      label: "Per m²",
      pricingModel: "area" as const,
      unitPrice: { default: price },
    });
    const cut = (id: string, label: string, price: number) => ({
      id,
      label: `Zuschnitt ${label}`,
      pricingModel: "count" as const,
      unitPrice: { default: price },
    });
    const laser = (code: string, variants: PriceListSourceItem["variants"]) =>
      item({
        code,
        workshops: ["makerspace"],
        category: ["Laser", "Sperrholz"],
        variants,
      });

    it("prints formats smallest first, per-unit last, dash for what a row lacks", () => {
      const data = derivePriceListRenderData(
        [
          laser("6010", [
            m2(42.34),
            cut("320-620", "320 × 620 mm", 8.4),
            cut("500-1250", "500 × 1250 mm", 26.45),
            cut("a3", "A3", 5.35),
          ]),
          laser("6001", [m2(24), cut("a3", "A3", 3)]),
        ],
        OPTS,
      );
      const [cat] = data.categories;
      expect(cat.priceColumns.map((c) => c.heading)).to.deep.equal([
        "A3",
        "320 × 620 mm",
        "500 × 1250 mm",
        "pro m²",
      ]);
      expect(cat.rows.map((r) => r.prices)).to.deep.equal([
        ["3.00", null, null, "24.00"],
        ["5.35", "8.40", "26.45", "42.34"],
      ]);
    });

    it("gives each unit of a mixed section its own column", () => {
      const data = derivePriceListRenderData(
        [
          item({
            code: "1",
            variants: [
              { id: "default", pricingModel: "weight", unitPrice: { default: 40 } },
            ],
          }),
          item({
            code: "2",
            variants: [
              { id: "default", pricingModel: "count", unitPrice: { default: 5 } },
            ],
          }),
        ],
        OPTS,
      );
      const [cat] = data.categories;
      expect(cat.priceColumns.map((c) => c.heading)).to.deep.equal([
        "pro kg",
        "pro Stk",
      ]);
      expect(cat.rows.map((r) => r.prices)).to.deep.equal([
        ["40.00", null],
        [null, "5.00"],
      ]);
    });

    it("keeps the column order when the same items are picked in another order", () => {
      const kg = item({
        code: "2",
        variants: [
          { id: "default", pricingModel: "weight", unitPrice: { default: 40 } },
        ],
      });
      const stk = item({
        code: "1",
        variants: [
          { id: "default", pricingModel: "count", unitPrice: { default: 5 } },
        ],
      });
      const forward = derivePriceListRenderData([kg, stk], OPTS);
      const reversed = derivePriceListRenderData([stk, kg], OPTS);
      expect(forward.categories).to.deep.equal(reversed.categories);
      expect(forward.categories[0].priceColumns.map((c) => c.heading)).to.deep.equal(
        ["pro Stk", "pro kg"],
      );
    });

    it("names a labelled base variant instead of printing its unit", () => {
      const size = (id: string, label: string, price: number) => ({
        id,
        label,
        pricingModel: "count" as const,
        unitPrice: { default: price },
      });
      const data = derivePriceListRenderData(
        [
          item({
            variants: [
              size("klein", "Klein", 10),
              size("mittel", "Mittel", 20),
              size("gross", "Gross", 30),
            ],
          }),
        ],
        OPTS,
      );
      expect(data.categories[0].priceColumns.map((c) => c.heading)).to.deep.equal(
        ["Klein", "Mittel", "Gross"],
      );
    });

    it("refuses a section with more price columns than fit, naming it", () => {
      const variants = [
        m2(100),
        ...["a", "b", "c", "d", "e"].map((id) => cut(id, id, 1)),
      ];
      expect(() =>
        derivePriceListRenderData([laser("6001", variants)], OPTS),
      )
        .to.throw(PriceListDeriveError, /Sperrholz.*6 price columns/)
        .with.property("reason", "too-many-variants");
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
