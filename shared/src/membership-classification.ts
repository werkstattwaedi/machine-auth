// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * SDK-agnostic classifier for the Vereinsmitgliedschaft (membership) SKU.
 *
 * The membership fee is appended to a checkout as an ordinary catalog item
 * (see `functions/src/membership/purchase.ts`), historically bucketed under
 * the `diverses` workshop. That made it surface under "Materialbezug" on the
 * checkout summary and under a "Diverses" heading on the bill — confusing,
 * because membership is not a material purchase (issues #262 / #263).
 *
 * These helpers identify membership items purely from their `catalogId` so
 * the web summary, the workshops step, and the bill PDF can render the
 * membership in its own dedicated bucket. The item shape is intentionally
 * narrow so callers can pass their own checkout-item type:
 *   - web `CheckoutItemLocal.catalogId` is `string | null`
 *   - functions `CheckoutItemEntity.catalogId` is a `DocumentReference | null`
 *     (which has an `.id` getter)
 *
 * Both forms are accepted via {@link MembershipClassifiableItem}.
 */

/**
 * A catalog reference as seen by either consumer: a plain doc-id string
 * (web) or an object exposing an `id` (a Firestore `DocumentReference`).
 */
export type CatalogIdLike = string | { id: string } | null | undefined

/** Narrow item shape the classifier needs — only the catalog reference. */
export interface MembershipClassifiableItem {
  catalogId?: CatalogIdLike
}

/** Options carrying the membership SKU's catalog doc id. */
export interface MembershipClassificationOptions {
  /**
   * The membership catalog doc id, resolved via `config/catalog-references`
   * → `membership`. `null` / `undefined` when no membership SKU is
   * configured — in that case nothing is classified as a membership item.
   */
  membershipCatalogId: string | null | undefined
}

/** Normalize a {@link CatalogIdLike} to its doc-id string (or null). */
function catalogIdOf(catalogId: CatalogIdLike): string | null {
  if (catalogId == null) return null
  if (typeof catalogId === "string") return catalogId
  return catalogId.id ?? null
}

/**
 * True when `item` is the membership-fee SKU. A non-membership item, an
 * item without a `catalogId`, or a missing/empty `membershipCatalogId` all
 * return `false`.
 */
export function isMembershipItem(
  item: MembershipClassifiableItem,
  { membershipCatalogId }: MembershipClassificationOptions,
): boolean {
  if (!membershipCatalogId) return false
  return catalogIdOf(item.catalogId) === membershipCatalogId
}

/**
 * Split `items` into membership items and everything else, preserving the
 * input order within each bucket. When no membership SKU is configured (or
 * none is present) `membershipItems` is empty and `otherItems` is the input.
 */
export function partitionMembership<T extends MembershipClassifiableItem>(
  items: readonly T[],
  options: MembershipClassificationOptions,
): { membershipItems: T[]; otherItems: T[] } {
  const membershipItems: T[] = []
  const otherItems: T[] = []
  for (const item of items) {
    if (isMembershipItem(item, options)) membershipItems.push(item)
    else otherItems.push(item)
  }
  return { membershipItems, otherItems }
}
