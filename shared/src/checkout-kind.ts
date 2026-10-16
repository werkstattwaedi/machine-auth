// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import {
  isMembershipItem,
  type MembershipClassifiableItem,
} from "./membership-classification"
import { isMachineItem } from "./pricing"
import type { CheckoutKind } from "./email-contract"

/**
 * A checkout with no visit behind it: a badge, membership or renewal the
 * server bought on its own (CHK-9). Marked by `purchaseOnly` since issue
 * #605 — a visit whose persons all only accompany is `materialbezug` too.
 * Older docs lack the flag; for them the `materialbezug` usage type is the
 * marker.
 */
export function isPurchaseOnly(checkout: {
  purchaseOnly?: boolean | null
  usageType?: string | null
}): boolean {
  return checkout.purchaseOnly ?? checkout.usageType === "materialbezug"
}

export interface CheckoutKindInput {
  usageType: string
  purchaseOnly?: boolean | null
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
  purchaseOnly,
  items,
  membershipCatalogId,
}: CheckoutKindInput): CheckoutKind {
  if (!isPurchaseOnly({ purchaseOnly, usageType })) return "visit"
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
