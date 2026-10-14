// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import type { CheckoutDoc } from "@modules/lib/firestore-entities"

/**
 * True when the open checkout is a started visit — the person is working in
 * the Werkstatt today. A `materialbezug` checkout is a purchase without a
 * visit (badge, membership or renewal bought on its own; the server creates
 * those as a side effect), so "Besuch starten" must stay on offer for it.
 * Legacy docs without `usageType` count as visits.
 */
export function isStartedVisit(
  checkout: Pick<CheckoutDoc, "usageType"> | null | undefined,
): boolean {
  return !!checkout && checkout.usageType !== "materialbezug"
}
