// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Pure derivation of {@link PriceListRenderData} from catalog items: groups
 * items into category tables, resolves the single workshop (color), and
 * computes the page title via the design's common-prefix rule. No Firestore
 * types so the logic is unit-testable in isolation.
 */

import {
  PRICING_MODEL_LABELS,
  WORKSHOP_COLORS,
  WORKSHOP_IDS,
  WORKSHOP_LABELS,
  isWorkshopId,
  type WorkshopId,
} from "@oww/shared";
import type {
  PriceListCategory,
  PriceListRenderData,
  PricingModel,
} from "./types";
import { MAX_PRICE_COLUMNS, categoryUnit } from "./types";

type SourceVariant = NonNullable<PriceListSourceItem["variants"]>[number];

/** The catalog fields the price list needs (subset of the catalog doc). */
export interface PriceListSourceItem {
  code: string;
  name: string;
  /** Curated label text; preferred over `name` (which embeds the mass). */
  labelName?: string | null;
  labelMass?: string | null;
  workshops?: string[];
  /** Root-to-leaf category path, e.g. ["Platten", "Sperrholz"]. */
  category?: string[];
  variants?: {
    id: string;
    /** Set when an item has several variants; "Per m²" for a priced-per-unit base. */
    label?: string | null;
    pricingModel: PricingModel;
    unitPrice?: { default?: number; member?: number };
  }[];
}

export class PriceListDeriveError extends Error {
  constructor(
    message: string,
    public readonly reason:
      | "empty"
      | "mixed-workshops"
      | "no-workshop"
      | "unknown-workshop"
      | "too-many-variants",
  ) {
    super(message);
    this.name = "PriceListDeriveError";
  }
}

function byCodeNumeric(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true });
}

/**
 * Resolve the single workshop the list belongs to. Items may be tagged with
 * several workshops (e.g. holz + makerspace); the list's workshop is one
 * every item shares. Ambiguity resolves in canonical WORKSHOP_IDS order.
 */
function resolveWorkshop(items: PriceListSourceItem[]): WorkshopId {
  // Items without workshop tags don't constrain the choice.
  const tagged = items.filter((i) => (i.workshops ?? []).length > 0);
  if (tagged.length === 0) {
    throw new PriceListDeriveError(
      "None of the items on this price list is tagged with a workshop.",
      "no-workshop",
    );
  }
  // Nothing validates the catalog `workshops` field at write time (the
  // admin editor is free text, the importer copies tab names through), so
  // an item whose tags are all unrecognized is broken catalog data — name
  // it as such instead of misreporting it as workshop mixing.
  const validSets = tagged.map((i) => i.workshops!.filter(isWorkshopId));
  const broken = tagged.filter((_, idx) => validSets[idx].length === 0);
  if (broken.length > 0) {
    const codes = broken.map((i) => i.code).join(", ");
    const tags = [...new Set(broken.flatMap((i) => i.workshops!))]
      .sort()
      .join(", ");
    throw new PriceListDeriveError(
      `Catalog item(s) ${codes} carry unrecognized workshop tags (${tags}) — ` +
        "fix the workshops field on those items.",
      "unknown-workshop",
    );
  }
  let candidates = validSets[0];
  for (const set of validSets.slice(1)) {
    const s = new Set(set);
    candidates = candidates.filter((ws) => s.has(ws));
  }
  if (candidates.length === 0) {
    const seen = [...new Set(validSets.flat())].sort();
    throw new PriceListDeriveError(
      `Price list mixes items from different workshops (${seen.join(", ")}). ` +
        "A price list must contain items of a single workshop.",
      "mixed-workshops",
    );
  }
  return WORKSHOP_IDS.find((ws) => candidates.includes(ws))!;
}

/** Longest common prefix of string paths. */
function commonPrefix(paths: string[][]): string[] {
  let common = paths[0].slice();
  for (const p of paths.slice(1)) {
    let i = 0;
    while (i < common.length && i < p.length && common[i] === p[i]) i++;
    common = common.slice(0, i);
  }
  return common;
}

export function formatPrice(amount: number): string {
  return amount.toFixed(2);
}

/**
 * The column a variant's price is printed in. Priced-per-unit bases of the
 * whole section share one column per unit, whatever their variant id; every
 * other option has its own, keyed by id so the same format lines up across rows.
 */
function priceColumnOf(
  variant: SourceVariant,
  index: number,
  variantCount: number,
): { key: string; heading: string; perUnit: boolean } {
  const label = variant.label ?? "";
  const perUnit =
    index === 0 &&
    (variantCount === 1 ||
      !label ||
      label === PRICING_MODEL_LABELS[variant.pricingModel]);
  if (perUnit) {
    const unit = categoryUnit(variant.pricingModel);
    return {
      key: `unit:${variant.pricingModel}`,
      heading: unit ? `pro ${unit}` : "",
      perUnit,
    };
  }
  // The column already sits under "Preis CHF"; "Zuschnitt" on every laser
  // format would only eat the width the column is short of.
  const heading = label.replace(/^Zuschnitt\s+/, "") || variant.id;
  return { key: `id:${variant.id}`, heading, perUnit };
}

/**
 * Lay a section's items out into price columns: named options cheapest first
 * (by price relative to the item's base, which stays put when prices change),
 * per-unit prices last. Items not sold in a column get a null cell.
 */
function derivePriceColumns(
  name: string,
  items: PriceListSourceItem[],
): Pick<PriceListCategory, "priceColumns"> & {
  pricesOf: (item: PriceListSourceItem) => (string | null)[];
} {
  interface Column {
    key: string;
    heading: string;
    perUnit: boolean;
    ratios: number[];
  }
  const columns = new Map<string, Column>();
  const fallback: SourceVariant = {
    id: "default",
    pricingModel: "direct",
    unitPrice: { default: 0 },
  };
  const variantsOf = (item: PriceListSourceItem) =>
    item.variants?.length ? item.variants : [fallback];

  for (const item of items) {
    const variants = variantsOf(item);
    const base = variants[0].unitPrice?.default ?? 0;
    variants.forEach((variant, idx) => {
      const col = priceColumnOf(variant, idx, variants.length);
      if (!columns.has(col.key)) columns.set(col.key, { ...col, ratios: [] });
      if (base > 0) {
        columns
          .get(col.key)!
          .ratios.push((variant.unitPrice?.default ?? 0) / base);
      }
    });
  }
  if (columns.size > MAX_PRICE_COLUMNS) {
    throw new PriceListDeriveError(
      `Section "${name}" would need ${columns.size} price columns ` +
        `(${[...columns.values()].map((c) => c.heading).join(", ")}), but a ` +
        `price list fits at most ${MAX_PRICE_COLUMNS} — remove variants or ` +
        "split the section.",
      "too-many-variants",
    );
  }

  const meanRatio = (c: Column) =>
    c.ratios.reduce((sum, r) => sum + r, 0) / (c.ratios.length || 1);
  const ordered = [...columns.values()].sort((a, b) => {
    if (a.perUnit !== b.perUnit) return a.perUnit ? 1 : -1;
    return a.perUnit ? 0 : meanRatio(a) - meanRatio(b);
  });

  return {
    priceColumns: ordered.map(({ heading }) => ({ heading })),
    pricesOf: (item) => {
      const variants = variantsOf(item);
      const cells = new Map(
        variants.map((variant, idx) => [
          priceColumnOf(variant, idx, variants.length).key,
          formatPrice(variant.unitPrice?.default ?? 0),
        ]),
      );
      return ordered.map(({ key }) => cells.get(key) ?? null);
    },
  };
}

/**
 * Build the render data for one price list.
 *
 * - Groups items by their full category path; tables are ordered by their
 *   lowest code, rows within a table by code (both numeric-aware).
 * - Title = last element of the longest common prefix of every item's
 *   [workshopLabel, ...categoryPath] — several categories with nothing else
 *   in common → the workshop name; exactly one category → that category's
 *   name (whose table heading is then suppressed).
 * - Every variant of an item gets a price cell; see derivePriceColumns.
 */
export function derivePriceListRenderData(
  items: PriceListSourceItem[],
  opts: { qrUrl: string; stand: string },
): PriceListRenderData {
  if (items.length === 0) {
    throw new PriceListDeriveError(
      "Price list has no items — add catalog items before generating the PDF.",
      "empty",
    );
  }

  const workshop = resolveWorkshop(items);
  const workshopLabel = WORKSHOP_LABELS[workshop];

  const paths = items.map((i) => [workshopLabel, ...(i.category ?? [])]);
  const common = commonPrefix(paths);
  // `common` always contains at least the workshop label.
  const title = common[common.length - 1];

  interface Group {
    path: string[];
    minCode: string;
    items: PriceListSourceItem[];
  }
  const groups = new Map<string, Group>();
  items.forEach((item, idx) => {
    const key = paths[idx].join("\u0000");
    let group = groups.get(key);
    if (!group) {
      group = { path: paths[idx], minCode: item.code, items: [] };
      groups.set(key, group);
    }
    group.items.push(item);
    if (byCodeNumeric(item.code, group.minCode) < 0) group.minCode = item.code;
  });

  const categories: PriceListCategory[] = [...groups.values()]
    .sort((a, b) => byCodeNumeric(a.minCode, b.minCode))
    .map((group) => {
      // Heading = the path below the shared prefix; a category that IS the
      // prefix (single-category list) falls back to the title and is hidden.
      const name = group.path.slice(common.length).join(" – ") || title;
      // Sorted before the columns too: their ties resolve by first seen, and
      // re-picking the same items must not change the printed list.
      const sorted = group.items
        .slice()
        .sort((a, b) => byCodeNumeric(a.code, b.code));
      const { priceColumns, pricesOf } = derivePriceColumns(name, sorted);
      const rows = sorted.map((item) => ({
        code: item.code,
        produkt: item.labelName || item.name,
        mass: item.labelMass ?? "",
        prices: pricesOf(item),
      }));
      return { name, showTitle: name !== title, priceColumns, rows };
    });

  return {
    title,
    color: WORKSHOP_COLORS[workshop],
    stand: opts.stand,
    qrUrl: opts.qrUrl,
    categories,
  };
}
