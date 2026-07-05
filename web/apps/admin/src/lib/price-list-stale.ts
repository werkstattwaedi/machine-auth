// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import type { Timestamp } from "firebase/firestore"

/**
 * Staleness of a generated price list PDF. "never" = no PDF generated
 * yet; "stale" = a listed catalog item changed (or vanished) after the
 * last generation, so the printed Aushang no longer matches the catalog.
 *
 * Best-effort: relies on the `modifiedAt` audit stamp on catalog items,
 * which every write path (upsert callable, importer, web mutations) sets.
 */
export type PriceListFreshness = "current" | "stale" | "never"

export function priceListFreshness(
  priceList: { items: string[]; generatedAt?: Timestamp | null },
  catalogModifiedAt: Map<string, Timestamp | undefined>,
): PriceListFreshness {
  const generatedAt = priceList.generatedAt
  if (!generatedAt) return "never"
  for (const itemId of priceList.items ?? []) {
    if (!catalogModifiedAt.has(itemId)) return "stale" // item deleted/retired
    const modifiedAt = catalogModifiedAt.get(itemId)
    if (modifiedAt && modifiedAt.toMillis() > generatedAt.toMillis()) {
      return "stale"
    }
  }
  return "current"
}
