// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import {
  isMembershipItem,
  type MembershipClassifiableItem,
} from "./membership-classification"
import { isMachineItem } from "./pricing"
import type { CheckoutKind } from "./email-contract"

/**
 * A checkout with no visit behind it: nobody works in the workshop, every
 * person is on Begleitung / nur Materialbezug (CHK-9) — the stored visit type
 * `deriveVisitUsageType` writes. The server's badge, membership and renewal
 * checkouts have no persons and store `materialbezug` directly.
 */
export function isPurchaseOnly(checkout: { usageType?: string | null }): boolean {
  return checkout.usageType === "materialbezug"
}

export interface CheckoutKindInput {
  usageType: string
  items: readonly (MembershipClassifiableItem & { type?: string | null })[]
  membershipCatalogId: string | null | undefined
}

/**
 * What a checkout was, for wording on bills and mails (issue #660) — see
 * `CHECKOUT_KINDS`. A membership or badge bought at the kiosk is a
 * purchase-only checkout (`isPurchaseOnly`) with no visit behind it, so it
 * must not read "Danke für deinen Besuch".
 *
 * Every other checkout means the person was in the workshop — even when the
 * net entry fee is 0 (intern, Begleitung, a fee already paid earlier that
 * day). A machine item is a visit regardless.
 */
export function classifyCheckoutKind({
  usageType,
  items,
  membershipCatalogId,
}: CheckoutKindInput): CheckoutKind {
  if (!isPurchaseOnly({ usageType })) return "visit"
  if (items.some((item) => isMachineItem(item))) return "visit"
  if (
    items.length > 0 &&
    items.every((item) => isMembershipItem(item, { membershipCatalogId }))
  ) {
    return "membership"
  }
  return "purchase"
}

/** A bill spans 1..n checkouts: any visit makes it a visit, all-membership a membership. */
export function classifyBillKind(kinds: readonly CheckoutKind[]): CheckoutKind {
  if (kinds.includes("visit")) return "visit"
  if (kinds.length > 0 && kinds.every((k) => k === "membership")) return "membership"
  return "purchase"
}
