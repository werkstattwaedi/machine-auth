// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Check Out preview of the same-day usage-fee waiver (issue #268,
 * ADR-0050): the wizard gets the owner's earlier visits of the opening
 * business day — closed or awaiting payment (#812) — and asks the shared
 * rule which persons are already covered, so the summary shows the total
 * the server will bill. A member's login reads them from Firestore; a kiosk
 * badge session, which the rules hold to the visit at hand (#854), gets
 * them from `getSameDayVisits`. The server decides again on close — this
 * only previews it.
 */

import {
  sameDayCoveredPersons,
  type SameDayCheckout,
  type UsageType,
} from "@oww/shared"
import type { CheckoutDoc } from "@modules/lib/firestore-entities"
import type { CheckoutPerson } from "./use-checkout-state"

/**
 * Shown beside a waived usage fee on the check-in and Check Out; the same
 * wording as the invoice PDF's waived usage-fee row.
 */
export const WAIVED_TODAY_LABEL = "heute bereits abgerechnet"

/** A roster person as the summary prices them. */
export type PricedPerson = CheckoutPerson & { entryFeeWaivedToday?: boolean }

/** A visit as `getSameDayVisits` returns it (dates as epoch ms). */
export interface SameDayVisitWire {
  id: string
  status: string | null
  usageType: string | null
  created: number | null
  closedAt: number | null
  persons: {
    name: string | null
    userType: string
    userRef: { id: string } | null
    usageType: string | null
  }[]
}

export function sameDayCheckoutFromWire(v: SameDayVisitWire): SameDayCheckout {
  return {
    id: v.id,
    status: v.status,
    usageType: v.usageType as UsageType | null,
    created: v.created != null ? new Date(v.created) : null,
    closedAt: v.closedAt != null ? new Date(v.closedAt) : null,
    persons: v.persons.map((p) => ({
      ...p,
      usageType: p.usageType as UsageType | null,
    })),
  }
}

export function toSameDayCheckout(
  c: CheckoutDoc & { id: string },
): SameDayCheckout {
  // Awaiting payment (#812): the terminal charged what the approved attempt
  // priced, and the approval report stands in for the close.
  const approved = c.status === "awaiting_payment" && c.terminalApproval
    ? c.terminalAttempts?.[String(c.terminalApproval.attempt)] ?? null
    : null
  return {
    id: c.id,
    status: c.status,
    cancelledAt: c.cancelledAt ?? null,
    // Typed as a plain string on the doc; an unknown value prices as
    // regular (`usageDiscount`).
    usageType: (approved?.usageType ?? c.usageType) as UsageType,
    created: c.created?.toDate?.() ?? null,
    closedAt: (approved ? c.terminalApproval?.reportedAt : c.closedAt)?.toDate?.() ?? null,
    persons: approved?.persons ?? c.persons ?? [],
  }
}

/**
 * `persons` with `entryFeeWaivedToday` set as the server would set it on
 * close. `openedAt` is the open checkout's `created` (now when it has none
 * yet); `earlierCheckouts` the owner's closed checkouts and those awaiting
 * payment (#812), at least those of the opening business day.
 */
export function withSameDayWaiver(
  persons: CheckoutPerson[],
  ownerId: string | null,
  openedAt: Date,
  earlierCheckouts: readonly SameDayCheckout[],
  currentCheckoutId: string | null,
): PricedPerson[] {
  const covered = sameDayCoveredPersons({
    persons: persons.map((p) => ({
      // The same full name the close payload sends.
      name: `${p.firstName} ${p.lastName}`,
      userType: p.userType,
      userRef: p.userId ? { id: p.userId } : null,
      usageType: p.usageType,
    })),
    ownerId,
    openedAt,
    earlierCheckouts,
    currentCheckoutId,
  })
  return persons.map((p, i) =>
    covered[i] ? { ...p, entryFeeWaivedToday: true } : p,
  )
}
