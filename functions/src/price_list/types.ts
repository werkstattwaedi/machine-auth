// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Price-list rendering types. Kept SDK-free so the PDF builder can be
 * unit-tested without firebase-admin types. PricingModel comes from
 * @oww/shared so this stays in lockstep with the catalog wire format.
 *
 * The shapes mirror the design handoff ("Werkstatt-Preislisten"): one PDF =
 * one workshop, one or more category tables with Code / Produkt / Mass /
 * "Preis CHF/<unit>" columns.
 */

import type { PricingModel } from "@oww/shared";
export type { DiscountLevel, PricingModel } from "@oww/shared";

/** One printed table row. All fields are pre-formatted strings. */
export interface PriceListRow {
  code: string;
  produkt: string;
  /** Size/dimension label ("24 mm", "Korn 60"); may be empty. */
  mass: string;
  /** Price with two decimals, e.g. "62.30". */
  preis: string;
}

/** One category table (heading + rows sharing a unit). */
export interface PriceListCategory {
  name: string;
  /**
   * False when the heading would repeat the page title (single-category
   * lists) — the design suppresses the duplicate heading.
   */
  showTitle: boolean;
  /** Unit label for the price column header ("m²", "lfm", …; may be empty). */
  unit: string;
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
 * Map a pricing model to the unit printed in the "Preis CHF/<unit>" table
 * header. `direct` prices carry no unit (header is just "Preis CHF").
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
