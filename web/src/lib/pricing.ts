// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import type { PricingConfig } from "./workshop-config"

/** User type affects base fee */
export type UserType = "erwachsen" | "kind" | "firma"

/** Usage type affects fee calculation */
export type UsageType = "regular" | "ermaessigt" | "materialbezug" | "intern" | "hangenmoos"

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

/** Hardcoded fallback fees per user type + usage type combination (CHF) */
const FEES: Record<UserType, Record<UsageType, number>> = {
  erwachsen: {
    regular: 15,
    ermaessigt: 7.5,
    materialbezug: 0,
    intern: 0,
    hangenmoos: 15,
  },
  kind: {
    regular: 7.5,
    ermaessigt: 3.75,
    materialbezug: 0,
    intern: 0,
    hangenmoos: 7.5,
  },
  firma: {
    regular: 30,
    ermaessigt: 15,
    materialbezug: 0,
    intern: 0,
    hangenmoos: 30,
  },
}

/** Calculate fee from Firestore config, falling back to hardcoded values */
export function calculateFee(
  userType: UserType,
  usageType: UsageType,
  config?: PricingConfig | null,
): number {
  if (config?.entryFees) {
    const feeRow = config.entryFees[userType]
    if (feeRow && usageType in feeRow) {
      return feeRow[usageType] ?? 0
    }
  }
  return FEES[userType]?.[usageType] ?? 0
}

export interface CheckoutPerson {
  name: string
  email: string
  userType: UserType
  usageType: UsageType
  fee: number
}

export function calculateTotal(
  persons: CheckoutPerson[],
  tip: number,
): number {
  const personFees = persons.reduce((sum, p) => sum + p.fee, 0)
  return personFees + Math.max(0, tip)
}
