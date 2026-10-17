// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { isPurchaseOnly } from "@oww/shared"
import type { CheckoutDoc } from "@modules/lib/firestore-entities"

/**
 * True when the open checkout is a started visit — the person is working in
 * the Werkstatt today. A purchase-only checkout — everyone on Begleitung /
 * nur Materialbezug, e.g. a badge or membership the server bought on its own
 * — is not, so "Besuch starten" must stay on offer for it (CHK-9). Docs
 * without a usage type count as visits.
 */
export function isStartedVisit(
  checkout: Pick<CheckoutDoc, "usageType"> | null | undefined,
): boolean {
  return !!checkout && !isPurchaseOnly(checkout)
}
