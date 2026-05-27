// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import {
  priceForTier,
  usageDiscount,
  type DiscountLevel,
  type UsageType,
  type UserType,
} from "@oww/shared"
import type { CatalogItemDoc, CatalogVariant } from "./firestore-entities"
import type { PricingConfig } from "./workshop-config"

export {
  priceForTier,
  usageDiscount,
  USAGE_TYPE_LABELS,
  USAGE_DISCOUNT_LABELS,
  USAGE_TYPE_DISCOUNTS,
  USER_TYPE_LABELS,
  type UsageType,
  type UserType,
} from "@oww/shared"

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

/**
 * Calculate the *billed* per-person entry fee: the standard (regular) fee
 * from `config/pricing.entryFees.{userType}.regular` scaled by the
 * usage-type entry-fee discount multiplier (`USAGE_TYPE_DISCOUNTS`, issue
 * #284). There is one standard fee per user type; the discount derives the
 * rest (`ermaessigt` = half, `intern`/`volunteering`/`materialbezug`/
 * `hangenmoos` = waived).
 *
 * Returns `null` when the config doc isn't loaded or doesn't contain a
 * `regular` fee for the user type — callers must surface that as a visible
 * error to staff (issue #149) rather than silently substituting a
 * hardcoded fallback. The previous fallback shipped fees that diverged
 * from the seeded production prices, so a misconfigured `config/pricing`
 * would have silently misbilled every customer.
 */
export function calculateFee(
  userType: UserType,
  usageType: UsageType,
  config: PricingConfig | null | undefined,
): number | null {
  const standard = standardFee(userType, config)
  if (standard === null) return null
  return standard * usageDiscount(usageType).entryFee
}

/**
 * The standard (regular) entry fee for a user type, before any usage-type
 * discount. Returns `null` on a missing config / `regular` row (fail-loud
 * contract, issue #149).
 */
export function standardFee(
  userType: UserType,
  config: PricingConfig | null | undefined,
): number | null {
  if (!config?.entryFees) return null
  const feeRow = config.entryFees[userType]
  if (!feeRow) return null
  // Use `in` to distinguish "missing key" (null) from "explicit zero" (0).
  if (!("regular" in feeRow)) return null
  return feeRow.regular ?? null
}
