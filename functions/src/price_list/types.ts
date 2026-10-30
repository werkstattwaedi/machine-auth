// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Price-list rendering types. Kept SDK-free so the PDF builder can be
 * unit-tested without firebase-admin types. PricingModel comes from
 * @oww/shared so this stays in lockstep with the catalog wire format.
 *
 * The shapes mirror the design handoff ("Werkstatt-Preislisten"): one PDF =
 * one workshop, one or more category tables with Code / Produkt / Mass and
 * one "Preis CHF" column per way the section's items are sold.
 */

import type { PricingModel } from "@oww/shared";
export type { DiscountLevel, PricingModel } from "@oww/shared";

/** One printed table row. All fields are pre-formatted strings. */
export interface PriceListRow {
  code: string;
  produkt: string;
  /** Size/dimension label ("24 mm", "Korn 60"); may be empty. */
  mass: string;
  /**
   * One cell per entry in the category's `priceColumns`: price with two
   * decimals ("62.30"), or null when this item isn't sold that way.
   */
  prices: (string | null)[];
}

/** One price column of a category table. */
export interface PriceListPriceColumn {
  /**
   * What the price is for, printed under "Preis CHF": "pro m²",
   * "320 × 620 mm"; empty when there is nothing to qualify ("direct" prices).
   */
  heading: string;
}

/**
 * More price columns than this can't be printed legibly next to Code, Produkt
 * and Mass on A4 portrait. Deriving a section beyond it fails: silently
 * leaving out a way the item is sold would misprice the wall list.
 */
export const MAX_PRICE_COLUMNS = 5;

/** One category table (heading + rows sharing its price columns). */
export interface PriceListCategory {
  name: string;
  /**
   * False when the heading would repeat the page title (single-category
   * lists) — the design suppresses the duplicate heading.
   */
  showTitle: boolean;
  priceColumns: PriceListPriceColumn[];
  rows: PriceListRow[];
}

export interface PriceListRenderData {
  /** Page title: last common element of [workshopLabel, ...categoryPath]. */
  title: string;
  /** Workshop brand color (Farbkonzept OWW hex). */
  color: string;
  /** Data date printed in the footer, "TT.MM.JJJJ". */
  stand: string;
  /** URL encoded into the header QR code (checkout deep link). */
  qrUrl: string;
  categories: PriceListCategory[];
}

/**
 * Map a pricing model to the unit printed in the price column's "pro <unit>"
 * heading. `direct` prices carry no unit (header is just "Preis CHF").
 */
export function categoryUnit(pm: PricingModel): string {
  switch (pm) {
    case "time":
      return "h";
    case "area":
      return "m²";
    case "length":
      return "lfm";
    case "count":
      return "Stk";
    case "weight":
      return "kg";
    case "sla":
      return "l";
    case "direct":
    default:
      return "";
  }
}
