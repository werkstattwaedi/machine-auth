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
  | "volunteering"

/**
 * The four billable sections of a checkout. The discount table
 * (`USAGE_TYPE_DISCOUNTS`) carries one multiplier per section, so adding a
 * new section is a compile error until every usage type provides a value.
 */
export type BillingSection = "entryFee" | "machine" | "material" | "tip"

/**
 * Per-usage-type discount: a multiplier in [0, 1] applied to each billing
 * section's *standard* amount. `1` bills the full standard amount, `0`
 * waives it, fractions discount it (e.g. `ermaessigt` pays half the entry
 * fee). This is the single authoritative pricing model — there is exactly
 * one set of standard fees (`config/pricing.entryFees.{userType}.regular`
 * for entry fees; the per-item prices for machine/material) and this table
 * is the fractional discount on top.
 *
 * Hardcoded here in `@oww/shared` (not config-driven) per issue #284 so
 * the server, web, and the invoice renderer all agree on the same waiving
 * rules without a Firestore round-trip. Tweaking these requires a code
 * change and review — intentional, because loosening them changes what
 * customers are billed.
 *
 * | usage type   | entry fee | machine | material | tip |
 * |--------------|-----------|---------|----------|-----|
 * | regular      | 1         | 1       | 1        | 1   |
 * | ermaessigt   | .5        | 1       | 1        | 1   |
 * | materialbezug| 0         | 0 (n/a) | 1        | 1   |
 * | hangenmoos   | 0         | 1       | 1        | 1   |
 * | volunteering | 0         | 0       | 1        | 1   |
 * | intern       | 0         | 0       | 0        | 1   |
 */
export type UsageDiscount = Record<BillingSection, number>

export const USAGE_TYPE_DISCOUNTS: Record<UsageType, UsageDiscount> = {
  regular: { entryFee: 1, machine: 1, material: 1, tip: 1 },
  ermaessigt: { entryFee: 0.5, machine: 1, material: 1, tip: 1 },
  // materialbezug waives entry + cannot have machine usage (guarded
  // server-side); the machine multiplier is 0 as a defensive belt-and-
  // suspenders should an nfc item ever slip through.
  materialbezug: { entryFee: 0, machine: 0, material: 1, tip: 1 },
  hangenmoos: { entryFee: 0, machine: 1, material: 1, tip: 1 },
  // volunteering (issue #284): a Freiwilligengruppe works on its own
  // projects — entry + machine on the house, material still billed.
  volunteering: { entryFee: 0, machine: 0, material: 1, tip: 1 },
  // intern: an internal OWW project — everything but the (optional) tip
  // is on the house.
  intern: { entryFee: 0, machine: 0, material: 0, tip: 1 },
}

/** The multiplier table for a usage type, defaulting to no discount. */
export function usageDiscount(usageType: UsageType): UsageDiscount {
  return USAGE_TYPE_DISCOUNTS[usageType] ?? USAGE_TYPE_DISCOUNTS.regular
}

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
 * What a line item *is*, for billing-section bucketing — independent of how
 * it was entered (`origin`). `machine` bills as "Maschinennutzung" and
 * follows the usage-type machine discount; `material` as "Materialbezug".
 * Stamped explicitly on every catalog and checkout item (issue #105); we
 * no longer infer machine-ness from `origin === "nfc"` or `pricingModel`.
 */
export type ItemType = "machine" | "material"

/**
 * True iff a line item is billed as machine usage. The explicit `type` is
 * authoritative — set on NFC sync, the material picker, and pinned
 * manual-hour rows. Items without it bill as material.
 */
export function isMachineItem(item: { type?: string | null }): boolean {
  return item.type === "machine"
}

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

/**
 * A concrete purchase option on a catalog item. SDK-agnostic (no firebase
 * coupling), so functions, the web apps, and the printer package share one
 * definition — the web `CatalogItemDoc` re-exports this.
 */
export interface CatalogVariant {
  /** Stable within the item, e.g. "default", "m2", "a3". */
  id: string
  /** Display label; only meaningful when an item has >1 variant. */
  label?: string | null
  pricingModel: PricingModel
  unitPrice: VariantPrice
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
  volunteering: "Freiwilligengruppe",
}

/**
 * Short German reason shown on a discounted section line ("…wird nicht
 * verrechnet (Freiwilligengruppe)"). Only set for usage types that waive
 * at least one section; `regular` has no discount and so no label.
 *
 * Marco's complaint (issue #284) was that an `intern` checkout silently
 * showed the line items at full price but a CHF 0.00 total — the discount
 * was invisible. The renderer uses this to spell out *why* a section was
 * waived on the section itself, rather than as a mystery negative line.
 */
export const USAGE_DISCOUNT_LABELS: Partial<Record<UsageType, string>> = {
  ermaessigt: "Ermässigung",
  materialbezug: "Nur Materialbezug",
  hangenmoos: "Hangenmoos AG",
  volunteering: "Freiwilligengruppe",
  intern: "Interne Nutzung",
}
