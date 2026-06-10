// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest"
import {
  normalizeSearchText,
  catalogSearchHaystack,
  matchesCatalogQuery,
} from "./text-search"
import type { CatalogItem } from "./workshop-config"

// Minimal catalog item fixture. Only the search-relevant fields matter;
// the rest of the CatalogItem shape is cast away so the test isn't coupled
// to unrelated schema fields.
function item(partial: {
  name: string
  code?: string
  category?: string[]
  description?: string | null
  variants?: Array<{ label?: string | null }>
}): CatalogItem {
  return {
    id: "x",
    name: partial.name,
    code: partial.code ?? "",
    category: partial.category ?? [],
    description: partial.description ?? null,
    variants: partial.variants ?? [],
  } as unknown as CatalogItem
}

// The pre-#452 filter: matched only name + code, lowercased (no folding).
// Used to prove the new tests genuinely catch the bug.
function oldFilter(c: CatalogItem, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return (
    c.name.toLowerCase().includes(q) ||
    (c.code?.toLowerCase().includes(q) ?? false)
  )
}

describe("normalizeSearchText", () => {
  it("folds German umlauts to their base letter", () => {
    expect(normalizeSearchText("Dübel")).toBe("dubel")
    expect(normalizeSearchText("Hölzer")).toBe("holzer")
  })

  it("maps ß to ss", () => {
    expect(normalizeSearchText("Rüstmaß")).toBe("rustmass")
  })

  it("collapses and trims whitespace", () => {
    expect(normalizeSearchText("  Eiche   Platte  ")).toBe("eiche platte")
  })

  it("returns empty string for whitespace-only input", () => {
    expect(normalizeSearchText("   ")).toBe("")
  })
})

describe("catalogSearchHaystack", () => {
  it("includes name, code, categories, description and variant labels", () => {
    const haystack = catalogSearchHaystack(
      item({
        name: "Buchenrundstab",
        code: "RND-12",
        category: ["Holz", "Rundstäbe"],
        description: "Massiv, geschliffen",
        variants: [{ label: "Ø 12 mm" }, { label: "Ø 20 mm" }],
      }),
    )
    expect(haystack).toContain("buchenrundstab")
    expect(haystack).toContain("rnd-12")
    expect(haystack).toContain("rundstabe")
    expect(haystack).toContain("geschliffen")
    expect(haystack).toContain("12 mm")
  })
})

describe("matchesCatalogQuery", () => {
  // Item whose NAME contains none of the queried terms below — so a match
  // can only come from category / description / variant fields.
  const rundstab = item({
    name: "Buchenrundstab",
    code: "RND-12",
    category: ["Holz", "Rundstäbe"],
    description: "Massiv, geschliffen für Möbelbau",
    variants: [{ label: "Ø 12 mm" }],
  })

  it("matches by category only", () => {
    expect(matchesCatalogQuery(rundstab, "rundstäbe")).toBe(true)
    // Regression guard: the old name+code-only filter would NOT find this.
    expect(oldFilter(rundstab, "rundstäbe")).toBe(false)
  })

  it("matches by description only", () => {
    expect(matchesCatalogQuery(rundstab, "möbelbau")).toBe(true)
    expect(oldFilter(rundstab, "möbelbau")).toBe(false)
  })

  it("matches by variant label only", () => {
    expect(matchesCatalogQuery(rundstab, "12 mm")).toBe(true)
    expect(oldFilter(rundstab, "12 mm")).toBe(false)
  })

  it("is diacritic-insensitive: a query without umlaut matches umlaut text", () => {
    const duebel = item({ name: "Dübel", category: ["Beschläge"] })
    expect(matchesCatalogQuery(duebel, "dubel")).toBe(true)
    // Old filter lowercased but did not fold, so "dubel" missed "Dübel".
    expect(oldFilter(duebel, "dubel")).toBe(false)
  })

  it("is diacritic-insensitive: an umlaut query matches non-umlaut text", () => {
    const holz = item({ name: "Holzleim", category: ["Leime"] })
    expect(matchesCatalogQuery(holz, "hölz")).toBe(true)
  })

  it("folds ß so a query with ss matches", () => {
    const masstab = item({ name: "Rüstmaß", category: ["Werkzeug"] })
    expect(matchesCatalogQuery(masstab, "rustmass")).toBe(true)
  })

  it("ANDs tokens across fields", () => {
    const eiche = item({
      name: "Leimholzplatte Eiche",
      category: ["Holzplatten"],
      description: "durchgehende Lamelle",
    })
    // both tokens present (name + description)
    expect(matchesCatalogQuery(eiche, "eiche lamelle")).toBe(true)
    // one token absent -> no match
    expect(matchesCatalogQuery(eiche, "eiche kiefer")).toBe(false)
  })

  it("returns true for an empty or whitespace-only query", () => {
    expect(matchesCatalogQuery(rundstab, "")).toBe(true)
    expect(matchesCatalogQuery(rundstab, "   ")).toBe(true)
  })
})
