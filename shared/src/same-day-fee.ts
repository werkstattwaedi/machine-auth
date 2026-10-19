// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Same-day usage-fee waiver (issue #268, reworked for ADR-0050): a person
 * pays the usage fee at most once per business day of an account. The
 * server (`markEntryFeeWaivedToday`, authoritative) and the checkout
 * wizard (preview on the Check Out page) both decide it here, so what the
 * page shows is what the bill charges.
 *
 * - A person is the account holder by account id, everyone else by name
 *   and person type — so a companion typed in again (or added from the
 *   saved persons) is recognised without being saved.
 * - Covered when the person is on another closed, non-cancelled visit of the
 *   same account — or one awaiting payment at the Wallee terminal (#812),
 *   whose fee the terminal already took — that was *opened* on the same business day, on a usage
 *   type whose fee is at least this line's — they pay the difference, which
 *   for every combination that can occur is all or nothing. A morning on
 *   Begleitung or Hangenmoos AG (no fee) covers nothing, so the regular
 *   afternoon is charged; a regular morning covers a regular afternoon.
 *   The person type is part of the identity, so comparing the usage types'
 *   fee multipliers compares the fees.
 * - A line that costs nothing anyway is never marked.
 * - Guests (no owner account) are never covered.
 */

import { isSameBusinessDay } from "./business-day"
import { isPurchaseOnly } from "./checkout-kind"
import { personUsageType, usageDiscount, type UsageType } from "./pricing"

/** A roster line as the waiver sees it (Firestore entity or wizard person). */
export interface SameDayPerson {
  name?: string | null
  userType: string
  /** Set on the owner's own line (ADR-0048); older lines may link others. */
  userRef?: { id: string } | null
  /** The line's own usage type (issue #605); older lines use the visit's. */
  usageType?: UsageType | null
}

/**
 * Statuses of an earlier visit that count (#812): an awaiting one's persons
 * and usage type are those of the approved terminal attempt — what the
 * terminal charged.
 */
export const SAME_DAY_COUNTED_STATUSES: readonly string[] = ["closed", "awaiting_payment"]

/** An earlier checkout of the same account. */
export interface SameDayCheckout {
  id: string
  status?: string | null
  cancelledAt?: unknown
  usageType?: UsageType | null
  /** When the visit was opened — decides its business day. */
  created?: Date | null
  /**
   * When it was closed (legacy docs lack it: `created` stands in); for one
   * awaiting payment, when the terminal's approval was reported.
   */
  closedAt?: Date | null
  persons?: readonly SameDayPerson[] | null
}

/**
 * Lowercased, trimmed words in sorted order, so "Anna Alpha" and
 * " alpha  anna" match. No diacritic folding: "Müller" ≠ "Muller".
 */
export function normalizePersonName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .sort()
    .join(" ")
}

/**
 * The identity the waiver compares: the owner's line by account id, every
 * other line by normalized name + person type. Null when there is no owner
 * (guest checkout) or the line carries no name.
 */
export function samedayPersonKey(
  person: SameDayPerson,
  ownerId: string | null,
): string | null {
  if (!ownerId) return null
  if (person.userRef?.id === ownerId) return `account:${ownerId}`
  const name = normalizePersonName(person.name ?? "")
  if (!name) return null
  return `name:${person.userType}:${name}`
}

/**
 * Which of `persons` (index-aligned) already paid at least their fee here:
 * they appeared on another closed, non-cancelled visit of `ownerId` opened
 * on the same business day as `openedAt`, on a usage type whose fee is at
 * least theirs now. A line without its own `usageType` counts as regular.
 *
 * `currentCheckoutId` is skipped (the visit being closed or corrected).
 * `closedBefore` limits the earlier visits to those closed before that
 * instant — a correction passes the corrected visit's close time, so a
 * later visit that was itself waived because of it cannot waive it back.
 */
export function sameDayCoveredPersons(input: {
  persons: readonly SameDayPerson[]
  ownerId: string | null
  openedAt: Date
  earlierCheckouts: readonly SameDayCheckout[]
  currentCheckoutId?: string | null
  closedBefore?: Date | null
}): boolean[] {
  const { persons, ownerId, openedAt } = input
  const none = persons.map(() => false)
  if (!ownerId) return none

  // Per person: the highest usage-fee multiplier they were on today. With
  // "pay the difference" that is what they have paid in all.
  const paid = new Map<string, number>()
  for (const c of input.earlierCheckouts) {
    if (input.currentCheckoutId && c.id === input.currentCheckoutId) continue
    // The query already excludes cancelled visits (ADR-0042); checked here
    // too so callers can't widen it by accident.
    if (!SAME_DAY_COUNTED_STATUSES.includes(c.status ?? "") || c.cancelledAt) continue
    // A badge/membership bought without a visit charged no usage fee.
    if (isPurchaseOnly(c)) continue
    if (!c.created || !isSameBusinessDay(c.created, openedAt)) continue
    if (input.closedBefore) {
      const closed = c.closedAt ?? c.created
      if (closed.getTime() >= input.closedBefore.getTime()) continue
    }
    for (const p of c.persons ?? []) {
      const key = samedayPersonKey(p, ownerId)
      if (!key) continue
      const m = feeMultiplier(p, c.usageType ?? "regular")
      paid.set(key, Math.max(paid.get(key) ?? 0, m))
    }
  }
  if (paid.size === 0) return none

  return persons.map((p) => {
    const key = samedayPersonKey(p, ownerId)
    if (key === null) return false
    const due = feeMultiplier(p, "regular")
    return due > 0 && (paid.get(key) ?? 0) >= due
  })
}

function feeMultiplier(person: SameDayPerson, visitUsageType: UsageType): number {
  return usageDiscount(personUsageType(person, visitUsageType)).entryFee
}
