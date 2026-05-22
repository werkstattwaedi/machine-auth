// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/** User type affects base fee */
export type UserType = "erwachsen" | "kind" | "firma"

/** Usage type affects fee calculation — top-level on checkout */
export type UsageType =
  | "regular"
  | "ermaessigt"
  | "materialbezug"
  | "intern"
  | "hangenmoos"

export type PricingModel =
  | "time"
  | "area"
  | "length"
  | "count"
  | "weight"
  | "direct"
  | "sla"

export type DiscountLevel = "none" | "member"

/**
 * Per-variant price. `default` is mandatory and is what an un-discounted
 * customer pays. Additional tiers (today only `member`) are optional
 * overrides; if absent, the default applies. Schema-extensible to future
 * tiers (volunteer, child, …) without touching items that don't use them.
 */
export interface VariantPrice {
  default: number
  member?: number
}

/**
 * Resolve a `VariantPrice` for a given customer tier. `DiscountLevel`
 * `"none"` maps to `default` (un-discounted baseline). Other tiers fall
 * back to `default` when the override is not set on the variant.
 */
export function priceForTier(price: VariantPrice, tier: DiscountLevel): number {
  if (tier === "member" && typeof price.member === "number") return price.member
  return price.default
}

export const USER_TYPE_LABELS: Record<UserType, string> = {
  erwachsen: "Erwachsen",
  kind: "Kind (u. 18)",
  firma: "Firma",
}

export const USAGE_TYPE_LABELS: Record<UsageType, string> = {
  regular: "Reguläre Nutzung",
  ermaessigt: "Ermässigte Nutzung (KulturLegi)",
  materialbezug: "Nur Materialbezug",
  intern: "Interne Nutzung",
  hangenmoos: "Hangenmoos AG",
}
