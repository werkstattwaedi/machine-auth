// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import type { CatalogItemDoc } from "./firestore-entities"

/**
 * Category tree helpers for the material picker.
 *
 * Catalog items carry a root-to-leaf `category` path as a `string[]`
 * (e.g. `["Holzplatten", "Sperrholz"]`). Values are free-form — no
 * pre-registered enum. The picker derives the chip tree from the values
 * actually present among items in the current scope, so categories that
 * don't apply to any visible item never become visible chips.
 */

/**
 * Orders catalog labels the way a person reads them: runs of digits compare
 * by value, so "Korn 60" comes before "Korn 240" and "6 × 6" before
 * "10 × 10" (#823). Plain `localeCompare` sorts them as text.
 */
export const compareNatural: (a: string, b: string) => number = new Intl.Collator(
  "de-CH",
  { numeric: true },
).compare

/** A catalog item with at least the `category` field of `CatalogItemDoc`. */
export type CategorizedItem = Pick<CatalogItemDoc, "category">

/**
 * The set of unique values at one path depth among the given items,
 * restricted to items whose category begins with `prefix`. Order:
 * alphabetical (de-CH locale, numbers by value) so the picker chips are stable.
 *
 * Items without a value at `prefix.length` are skipped — that depth
 * simply doesn't apply to them, the picker doesn't render a chip for
 * "nothing".
 */
export function nextLevelValues(
  items: ReadonlyArray<CategorizedItem>,
  prefix: ReadonlyArray<string>,
): string[] {
  const set = new Set<string>()
  for (const item of items) {
    if (!startsWithPrefix(item.category, prefix)) continue
    const next = item.category?.[prefix.length]
    if (next != null && next !== "") set.add(next)
  }
  return [...set].sort(compareNatural)
}

/**
 * True iff `path` begins with every element of `prefix` in order. A
 * zero-length prefix matches every item (used for the top-level chip
 * row when no chip is selected yet).
 */
export function startsWithPrefix(
  path: ReadonlyArray<string> | null | undefined,
  prefix: ReadonlyArray<string>,
): boolean {
  if (prefix.length === 0) return true
  if (!path || path.length < prefix.length) return false
  for (let i = 0; i < prefix.length; i++) {
    if (path[i] !== prefix[i]) return false
  }
  return true
}

/**
 * Filter items to those whose `category` begins with `prefix`. With an
 * empty prefix, returns the input array.
 */
export function filterByCategoryPrefix<T extends CategorizedItem>(
  items: ReadonlyArray<T>,
  prefix: ReadonlyArray<string>,
): T[] {
  if (prefix.length === 0) return [...items]
  return items.filter((i) => startsWithPrefix(i.category, prefix))
}

/**
 * Number of items at each prefix depth. Used so the picker can disable
 * a chip if no items remain after selecting it (defensive — shouldn't
 * normally happen because the chips themselves are derived from the
 * items, but useful when external filters like the text search apply
 * on top).
 */
export function itemCountForPrefix(
  items: ReadonlyArray<CategorizedItem>,
  prefix: ReadonlyArray<string>,
): number {
  let n = 0
  for (const item of items) if (startsWithPrefix(item.category, prefix)) n++
  return n
}
