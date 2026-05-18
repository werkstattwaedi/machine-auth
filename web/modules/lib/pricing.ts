// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import type {
  CatalogItemDoc,
  CatalogVariant,
  DiscountLevel,
  VariantPrice,
} from "./firestore-entities"
import type { PricingConfig } from "./workshop-config"

/** User type affects base fee */
export type UserType = "erwachsen" | "kind" | "firma"

/**
 * Resolve a `VariantPrice` for a given customer tier. `DiscountLevel`
 * `"none"` maps to `default` (un-discounted baseline). Other tiers fall
 * back to `default` when the override is not set on the variant.
 */
export function priceForTier(price: VariantPrice, tier: DiscountLevel): number {
  if (tier === "member" && typeof price.member === "number") return price.member
  return price.default
}

/**
 * The canonical variant for a catalog item. `variants[0]` by convention.
 * Returns `undefined` only for malformed catalog docs (variants array
 * missing or empty), which the picker should treat as inactive.
 *
 * Today the picker always uses the primary variant silently; PR C will
 * surface a variant selector for items with `variants.length > 1`.
 */
export function primaryVariant(
  catalog: Pick<CatalogItemDoc, "variants">,
): CatalogVariant | undefined {
  return catalog.variants?.[0]
}

/**
 * Resolve the unit price of a catalog item for the given customer tier,
 * picking the canonical variant. Returns 0 when the catalog doc has no
 * variants (defensive — should never happen with valid seed data).
 */
export function catalogPriceForTier(
  catalog: Pick<CatalogItemDoc, "variants">,
  tier: DiscountLevel,
): number {
  const v = primaryVariant(catalog)
  return v ? priceForTier(v.unitPrice, tier) : 0
}

/** Usage type affects fee calculation — top-level on checkout */
export type UsageType =
  | "regular"
  | "ermaessigt"
  | "materialbezug"
  | "intern"
  | "hangenmoos"

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

/**
 * Calculate per-person entry fee from `config/pricing.entryFees`.
 *
 * Returns `null` when the config doc isn't loaded or doesn't contain a row
 * for the requested userType + usageType combination — callers must surface
 * that as a visible error to staff (issue #149) rather than silently
 * substituting a hardcoded fallback. The previous fallback shipped fees
 * that diverged from the seeded production prices, so a misconfigured
 * `config/pricing` would have silently misbilled every customer.
 */
export function calculateFee(
  userType: UserType,
  usageType: UsageType,
  config: PricingConfig | null | undefined,
): number | null {
  if (!config?.entryFees) return null
  const feeRow = config.entryFees[userType]
  if (!feeRow) return null
  // Use `in` to distinguish "missing key" (null) from "explicit zero" (0).
  if (!(usageType in feeRow)) return null
  return feeRow[usageType] ?? null
}
