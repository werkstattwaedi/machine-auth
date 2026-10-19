// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import type { CheckoutDoc } from "./firestore-entities"

/**
 * CHF the Wallee terminal approved for a checkout awaiting payment (#812).
 * Such a checkout has no `summary` yet; the approved attempt holds what was
 * priced. Null for any other checkout.
 */
export function awaitingPaymentAmount(
  checkout: Pick<CheckoutDoc, "status" | "terminalApproval" | "terminalAttempts">,
): number | null {
  if (checkout.status !== "awaiting_payment" || !checkout.terminalApproval) return null
  return checkout.terminalAttempts?.[String(checkout.terminalApproval.attempt)]?.amount ?? null
}
