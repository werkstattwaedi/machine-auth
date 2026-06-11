// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import type { CatalogItem } from "./workshop-config"

/**
 * Fold free text for accent-insensitive, case-insensitive substring search.
 *
 * Steps: map `ß → ss`, NFD-decompose so umlauts/accents split into a base
 * letter + a combining mark, strip the combining marks (`\p{Diacritic}`),
 * lowercase, then collapse runs of whitespace and trim. This makes `dübel`
 * and `dubel` fold to the same string so a member who can't (or won't) type
 * the umlaut still finds the item. Diacritics are *stripped* (`ö → o`), not
 * expanded (`ö → oe`), so an `oe`-style query (`duebel`) is intentionally not
 * matched — see issue #452.
 */
export function normalizeSearchText(s: string): string {
  return s
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Build the normalized haystack a catalog item is searched against: its
 * name, code, every category-path segment, the description, and each
 * variant label. Joined with spaces and folded once via
 * `normalizeSearchText`.
 */
export function catalogSearchHaystack(item: CatalogItem): string {
  const parts: Array<string | null | undefined> = [
    item.name,
    item.code,
    ...(item.category ?? []),
    item.description,
    ...(item.variants ?? []).map((v) => v.label),
  ]
  return normalizeSearchText(parts.filter(Boolean).join(" "))
}

/**
 * True when every whitespace-separated, normalized token in `query` is a
 * substring of the item's haystack (token-AND, so `eiche platte` narrows
 * across fields). An empty / whitespace-only query matches everything.
 */
export function matchesCatalogQuery(item: CatalogItem, query: string): boolean {
  const normalizedQuery = normalizeSearchText(query)
  if (normalizedQuery.length === 0) return true
  const haystack = catalogSearchHaystack(item)
  return normalizedQuery.split(" ").every((token) => haystack.includes(token))
}
