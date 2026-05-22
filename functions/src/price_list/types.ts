// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Price-list rendering types. Kept SDK-free so the PDF builder can be
 * unit-tested without firebase-admin types. PricingModel + DiscountLevel
 * come from @oww/shared so this stays in lockstep with the catalog wire
 * format.
 */

import type { DiscountLevel, PricingModel } from "@oww/shared";
export type { DiscountLevel, PricingModel } from "@oww/shared";

export interface PriceListCatalogItem {
  code: string;
  name: string;
  pricingModel: PricingModel;
  unitPrice: Partial<Record<DiscountLevel, number>>;
}

export interface PriceListRenderData {
  name: string;
  footer: string;
  /** URL encoded into the footer QR code (typically the checkout deep link). */
  qrUrl: string;
  /** Pre-sorted catalog items to render. */
  items: PriceListCatalogItem[];
}

/** Map a pricing model to the short unit label printed in the table. */
export function shortUnit(pm: PricingModel, currency = "CHF"): string {
  switch (pm) {
    case "time":
      return "h";
    case "area":
      return "m²";
    case "length":
      return "m";
    case "count":
      return "Stk.";
    case "weight":
      return "kg";
    case "direct":
      return currency;
    case "sla":
      return "l";
    default:
      return "";
  }
}
