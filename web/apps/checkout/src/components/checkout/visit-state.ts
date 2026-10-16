// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { isPurchaseOnly } from "@oww/shared"
import type { CheckoutDoc } from "@modules/lib/firestore-entities"

/**
 * True when the open checkout is a started visit — the person is working in
 * the Werkstatt today. A purchase-only checkout (badge, membership or
 * renewal bought on its own; the server creates those as a side effect) is
 * not, so "Besuch starten" must stay on offer for it (CHK-9). Older docs
 * without `purchaseOnly` fall back to the `materialbezug` usage type
 * (`isPurchaseOnly`); docs with neither count as visits.
 */
export function isStartedVisit(
  checkout: Pick<CheckoutDoc, "usageType" | "purchaseOnly"> | null | undefined,
): boolean {
  return !!checkout && !isPurchaseOnly(checkout)
}
