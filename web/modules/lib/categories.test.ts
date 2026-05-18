// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest"
import {
  filterByCategoryPrefix,
  itemCountForPrefix,
  nextLevelValues,
  startsWithPrefix,
} from "./categories"

const items = [
  { category: ["Holzplatten", "Sperrholz"] },
  { category: ["Holzplatten", "Sperrholz"] },
  { category: ["Holzplatten", "MDF"] },
  { category: ["Massivholz"] },
  { category: ["Schleifmittel", "Schleifband (Makita)"] },
  { category: ["Schleifmittel", "Schleifscheiben (Festool)"] },
  // Defensive cases: missing / empty category should not crash callers.
  { category: [] },
  { category: undefined as unknown as string[] },
]

describe("startsWithPrefix", () => {
  it("empty prefix matches everything", () => {
    expect(startsWithPrefix(["Holzplatten", "Sperrholz"], [])).toBe(true)
    expect(startsWithPrefix(undefined, [])).toBe(true)
  })
  it("exact prefix match", () => {
    expect(startsWithPrefix(["Holzplatten", "Sperrholz"], ["Holzplatten"])).toBe(true)
    expect(
      startsWithPrefix(["Holzplatten", "Sperrholz"], ["Holzplatten", "Sperrholz"]),
    ).toBe(true)
  })
  it("mismatch", () => {
    expect(startsWithPrefix(["Holzplatten"], ["Massivholz"])).toBe(false)
    expect(startsWithPrefix(["Holzplatten"], ["Holzplatten", "Sperrholz"])).toBe(false)
  })
  it("nullish path", () => {
    expect(startsWithPrefix(null, ["Holzplatten"])).toBe(false)
  })
})

describe("nextLevelValues", () => {
  it("top-level chip set is the union of all category[0] values, alphabetised", () => {
    expect(nextLevelValues(items, [])).toEqual([
      "Holzplatten",
      "Massivholz",
      "Schleifmittel",
    ])
  })
  it("narrows under a selected top-level chip", () => {
    expect(nextLevelValues(items, ["Holzplatten"])).toEqual(["MDF", "Sperrholz"])
    expect(nextLevelValues(items, ["Schleifmittel"])).toEqual([
      "Schleifband (Makita)",
      "Schleifscheiben (Festool)",
    ])
  })
  it("returns empty array when no items match the prefix", () => {
    expect(nextLevelValues(items, ["Nope"])).toEqual([])
  })
  it("returns empty array when the matching items have no deeper level", () => {
    // Massivholz items are depth-1; under that prefix there's no [1].
    expect(nextLevelValues(items, ["Massivholz"])).toEqual([])
  })
  it("dedupes repeated values", () => {
    expect(nextLevelValues(items, ["Holzplatten"])).toHaveLength(2)
  })
})

describe("filterByCategoryPrefix", () => {
  it("empty prefix returns all", () => {
    expect(filterByCategoryPrefix(items, [])).toHaveLength(items.length)
  })
  it("filters by top-level value", () => {
    expect(filterByCategoryPrefix(items, ["Holzplatten"])).toHaveLength(3)
  })
  it("filters by full leaf path", () => {
    expect(filterByCategoryPrefix(items, ["Holzplatten", "Sperrholz"])).toHaveLength(2)
  })
})

describe("itemCountForPrefix", () => {
  it("counts by prefix", () => {
    expect(itemCountForPrefix(items, [])).toBe(items.length)
    expect(itemCountForPrefix(items, ["Holzplatten"])).toBe(3)
    expect(itemCountForPrefix(items, ["Holzplatten", "MDF"])).toBe(1)
    expect(itemCountForPrefix(items, ["DoesNotExist"])).toBe(0)
  })
})
