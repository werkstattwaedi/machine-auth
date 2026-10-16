// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * The checkout summary arithmetic (issue #284), SDK-agnostic so the server
 * (`recomputeSummary`, authoritative), the checkout wizard (live receipt)
 * and the admin correction editor (estimate, ADR-0042) share ONE
 * implementation: RAW per-section amounts, the usage-type discount
 * multipliers (each person's own type on their usage fee, the visit's
 * type on machines and material — issue #605), cents rounding, and the waived-today
 * entry-fee rule. Callers supply the standard entry fee lookup so each
 * side keeps its own config-loading contract (fail-loud on the server,
 * `null`-tolerant in the web apps).
 */

import {
  isMachineItem,
  personUsageType,
  usageDiscount,
  type UsageType,
} from "./pricing"

export interface SummaryPerson {
  userType: string
  /** Already paid the daily usage fee earlier the same business day (issue #268). */
  entryFeeWaivedToday?: boolean | null
  /** The person's own usage type (issue #605); absent on older checkouts. */
  usageType?: UsageType | null
}

export interface SummaryItem {
  type?: string | null
  totalPrice: number
}

/** RAW (pre-discount) section amounts. */
export interface RawSections {
  entryFees: number
  machineCost: number
  materialCost: number
  tip: number
}

export interface CheckoutSummary extends RawSections {
  /** Net amount actually billed (raw sections minus the usage discount). */
  totalPrice: number
  /** `(entryFees + machineCost + materialCost + tip) - totalPrice`. */
  discountAmount: number
}

export function roundCents(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * RAW section amounts: standard entry fees (skipping waived persons),
 * machine and material items by `type`, and the (never negative) tip.
 */
export function rawSections(input: {
  persons: SummaryPerson[]
  items: SummaryItem[]
  standardEntryFee: (userType: string) => number
  tip?: number
}): RawSections {
  const entryFees = input.persons.reduce(
    (sum, p) => sum + (p.entryFeeWaivedToday ? 0 : input.standardEntryFee(p.userType)),
    0,
  )
  const machineCost = input.items
    .filter((i) => isMachineItem(i))
    .reduce((sum, i) => sum + (i.totalPrice ?? 0), 0)
  const materialCost = input.items
    .filter((i) => !isMachineItem(i))
    .reduce((sum, i) => sum + (i.totalPrice ?? 0), 0)
  const tip = Math.max(0, input.tip ?? 0)
  return { entryFees, machineCost, materialCost, tip }
}

/**
 * What one person pays as usage fee: their standard fee times their own
 * usage type's entry-fee multiplier (the visit's type for checkouts from
 * before issue #605), 0 when already paid that day.
 */
export function personEntryFee(
  person: SummaryPerson,
  visitUsageType: UsageType,
  standardEntryFee: (userType: string) => number,
): number {
  if (person.entryFeeWaivedToday) return 0
  const type = personUsageType(person, visitUsageType)
  return roundCents(standardEntryFee(person.userType) * usageDiscount(type).entryFee)
}

/**
 * The stored summary: RAW sections (so the invoice can spell out what was
 * waived) plus the NET total after the usage-type discounts. `usageType`
 * is the visit's type (`deriveVisitUsageType`).
 */
export function computeCheckoutSummary(input: {
  persons: SummaryPerson[]
  usageType: UsageType
  items: SummaryItem[]
  standardEntryFee: (userType: string) => number
  tip: number
}): CheckoutSummary {
  const raw = rawSections(input)
  const discount = usageDiscount(input.usageType)
  const netEntryFees = input.persons.reduce(
    (sum, p) => sum + personEntryFee(p, input.usageType, input.standardEntryFee),
    0,
  )
  const totalPrice = roundCents(
    netEntryFees +
      raw.machineCost * discount.machine +
      raw.materialCost * discount.material +
      raw.tip * discount.tip,
  )
  const rawTotal = roundCents(raw.entryFees + raw.machineCost + raw.materialCost + raw.tip)
  return {
    totalPrice,
    entryFees: roundCents(raw.entryFees),
    machineCost: roundCents(raw.machineCost),
    materialCost: roundCents(raw.materialCost),
    tip: roundCents(raw.tip),
    discountAmount: roundCents(rawTotal - totalPrice),
  }
}
