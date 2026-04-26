// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Price-list rendering types. Mirrors the web schema in
 * web/modules/lib/workshop-config.ts but kept independent so the PDF builder
 * can be unit-tested without firebase-admin types.
 */

export type PricingModel =
  | "time"
  | "area"
  | "length"
  | "count"
  | "weight"
  | "direct"
  | "sla";

export type DiscountLevel = "none" | "member" | "intern";

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
