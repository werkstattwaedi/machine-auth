// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * SDK-agnostic classifier for the NFC-Badge SKU (self-service badge
 * purchase at the kiosk). Mirrors membership-classification.ts: badge
 * items are appended to a checkout as ordinary catalog items bucketed
 * under `diverses`, and these helpers break them out into their own UI /
 * bill section by `catalogId`.
 */

import type {
  CatalogIdLike,
  MembershipClassifiableItem,
} from "./membership-classification"

/** Options carrying the badge SKU's catalog doc id. */
export interface BadgeClassificationOptions {
  /**
   * The badge catalog doc id, resolved via `config/catalog-references` →
   * `badge`. `null` / `undefined` when no badge SKU is configured — then
   * nothing is classified as a badge item.
   */
  badgeCatalogId: string | null | undefined
}

function catalogIdOf(catalogId: CatalogIdLike): string | null {
  if (catalogId == null) return null
  if (typeof catalogId === "string") return catalogId
  return catalogId.id ?? null
}

/** True when `item` is the badge SKU. */
export function isBadgeCatalogItem(
  item: MembershipClassifiableItem,
  { badgeCatalogId }: BadgeClassificationOptions,
): boolean {
  if (!badgeCatalogId) return false
  return catalogIdOf(item.catalogId) === badgeCatalogId
}

/**
 * Split `items` into badge items and everything else, preserving input
 * order within each bucket.
 */
export function partitionBadge<T extends MembershipClassifiableItem>(
  items: readonly T[],
  options: BadgeClassificationOptions,
): { badgeItems: T[]; otherItems: T[] } {
  const badgeItems: T[] = []
  const otherItems: T[] = []
  for (const item of items) {
    if (isBadgeCatalogItem(item, options)) badgeItems.push(item)
    else otherItems.push(item)
  }
  return { badgeItems, otherItems }
}
