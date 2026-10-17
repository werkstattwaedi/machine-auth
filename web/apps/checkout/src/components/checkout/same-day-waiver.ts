// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Check Out preview of the same-day usage-fee waiver (issue #268,
 * ADR-0050): the wizard reads the owner's closed checkouts and asks the
 * shared rule which persons are already covered today, so the summary
 * shows the total the server will bill. The server decides again on
 * close — this only previews it.
 */

import {
  sameDayCoveredPersons,
  type SameDayCheckout,
  type UsageType,
} from "@oww/shared"
import type { CheckoutDoc } from "@modules/lib/firestore-entities"
import type { CheckoutPerson } from "./use-checkout-state"

/** A roster person as the summary prices them. */
export type PricedPerson = CheckoutPerson & { entryFeeWaivedToday?: boolean }

function toSameDayCheckout(c: CheckoutDoc & { id: string }): SameDayCheckout {
  return {
    id: c.id,
    status: c.status,
    cancelledAt: c.cancelledAt ?? null,
    // Typed as a plain string on the doc; an unknown value prices as
    // regular (`usageDiscount`).
    usageType: c.usageType as UsageType,
    created: c.created?.toDate?.() ?? null,
    closedAt: c.closedAt?.toDate?.() ?? null,
    persons: c.persons ?? [],
  }
}

/**
 * `persons` with `entryFeeWaivedToday` set as the server would set it on
 * close. `openedAt` is the open checkout's `created` (now when it has none
 * yet); `closedCheckouts` the owner's closed checkouts.
 */
export function withSameDayWaiver(
  persons: CheckoutPerson[],
  ownerId: string | null,
  openedAt: Date,
  closedCheckouts: readonly (CheckoutDoc & { id: string })[],
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
    earlierCheckouts: closedCheckouts.map(toSameDayCheckout),
    currentCheckoutId,
  })
  return persons.map((p, i) =>
    covered[i] ? { ...p, entryFeeWaivedToday: true } : p,
  )
}
