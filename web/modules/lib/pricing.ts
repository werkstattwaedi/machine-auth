// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import type { PricingConfig } from "./workshop-config"

/** User type affects base fee */
export type UserType = "erwachsen" | "kind" | "firma"

/** Usage type affects fee calculation — top-level on checkout */
export type UsageType = "regular" | "materialbezug" | "intern" | "hangenmoos"

export const USER_TYPE_LABELS: Record<UserType, string> = {
  erwachsen: "Erwachsen",
  kind: "Kind (u. 18)",
  firma: "Firma",
}

export const USAGE_TYPE_LABELS: Record<UsageType, string> = {
  regular: "Reguläre Nutzung",
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
