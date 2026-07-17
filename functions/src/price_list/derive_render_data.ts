// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Pure derivation of {@link PriceListRenderData} from catalog items: groups
 * items into category tables, resolves the single workshop (color), and
 * computes the page title via the design's common-prefix rule. No Firestore
 * types so the logic is unit-testable in isolation.
 */

import {
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
import { categoryUnit } from "./types";

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
    pricingModel: PricingModel;
    unitPrice?: { default?: number; member?: number };
  }[];
}

export class PriceListDeriveError extends Error {
  constructor(
    message: string,
    public readonly reason:
      "empty" | "mixed-workshops" | "no-workshop" | "unknown-workshop",
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
 * Build the render data for one price list.
 *
 * - Groups items by their full category path; tables are ordered by their
 *   lowest code, rows within a table by code (both numeric-aware).
 * - Title = last element of the longest common prefix of every item's
 *   [workshopLabel, ...categoryPath] — several categories with nothing else
 *   in common → the workshop name; exactly one category → that category's
 *   name (whose table heading is then suppressed).
 * - Unit and price come from the item's canonical variant (variants[0]).
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
      const rows = group.items
        .slice()
        .sort((a, b) => byCodeNumeric(a.code, b.code))
        .map((item) => ({
          code: item.code,
          produkt: item.labelName || item.name,
          mass: item.labelMass ?? "",
          preis: formatPrice(item.variants?.[0]?.unitPrice?.default ?? 0),
        }));
      // Heading = the path below the shared prefix; a category that IS the
      // prefix (single-category list) falls back to the title and is hidden.
      const name = group.path.slice(common.length).join(" – ") || title;
      const unit = categoryUnit(
        group.items[0].variants?.[0]?.pricingModel ?? "direct",
      );
      return { name, showTitle: name !== title, unit, rows };
    });

  return {
    title,
    color: WORKSHOP_COLORS[workshop],
    stand: opts.stand,
    qrUrl: opts.qrUrl,
    categories,
  };
}
