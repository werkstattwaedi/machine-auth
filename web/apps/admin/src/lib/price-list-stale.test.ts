// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest"
import { Timestamp } from "firebase/firestore"
import { priceListFreshness } from "./price-list-stale"

const T0 = Timestamp.fromMillis(1_000_000)
const T1 = Timestamp.fromMillis(2_000_000)
const T2 = Timestamp.fromMillis(3_000_000)

describe("priceListFreshness", () => {
  it("is 'never' without a generation stamp", () => {
    expect(priceListFreshness({ items: ["a"] }, new Map())).toBe("never")
    expect(
      priceListFreshness({ items: ["a"], generatedAt: null }, new Map()),
    ).toBe("never")
  })

  it("is 'current' when no listed item changed since generation", () => {
    const catalog = new Map([
      ["a", T0],
      ["b", undefined], // legacy doc without modifiedAt — treated as unchanged
    ])
    expect(
      priceListFreshness({ items: ["a", "b"], generatedAt: T1 }, catalog),
    ).toBe("current")
  })

  it("is 'stale' when a listed item changed after generation", () => {
    const catalog = new Map([
      ["a", T0],
      ["b", T2],
    ])
    expect(
      priceListFreshness({ items: ["a", "b"], generatedAt: T1 }, catalog),
    ).toBe("stale")
  })

  it("is 'stale' when a listed item no longer exists", () => {
    expect(
      priceListFreshness({ items: ["gone"], generatedAt: T1 }, new Map()),
    ).toBe("stale")
  })

  it("ignores changes to items not on the list", () => {
    const catalog = new Map([
      ["a", T0],
      ["other", T2],
    ])
    expect(priceListFreshness({ items: ["a"], generatedAt: T1 }, catalog)).toBe(
      "current",
    )
  })
})
