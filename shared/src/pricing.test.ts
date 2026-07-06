// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest"
import {
  USAGE_TYPE_DISCOUNTS,
  USAGE_TYPE_LABELS,
  USAGE_DISCOUNT_LABELS,
  usageDiscount,
  isMachineItem,
  type UsageType,
} from "./pricing"

// Issue #284: the discount table is the single authoritative source for
// the fractional per-usage-type waivers. These tests pin the exact table
// Marco + Mike agreed on so a regression in the multipliers fails loudly.
describe("USAGE_TYPE_DISCOUNTS (issue #284)", () => {
  it("matches the agreed multiplier table", () => {
    expect(USAGE_TYPE_DISCOUNTS).toEqual({
      regular: { entryFee: 1, machine: 1, material: 1, tip: 1 },
      ermaessigt: { entryFee: 0.5, machine: 1, material: 1, tip: 1 },
      materialbezug: { entryFee: 0, machine: 0, material: 1, tip: 1 },
      hangenmoos: { entryFee: 0, machine: 1, material: 1, tip: 1 },
      volunteering: { entryFee: 0, machine: 0, material: 1, tip: 1 },
      intern: { entryFee: 0, machine: 0, material: 0, tip: 1 },
    })
  })

  it("never discounts the tip for any usage type", () => {
    for (const ut of Object.keys(USAGE_TYPE_DISCOUNTS) as UsageType[]) {
      expect(usageDiscount(ut).tip).toBe(1)
    }
  })

  it("falls back to the regular (no-discount) row for unknown usage types", () => {
    expect(usageDiscount("nonsense" as UsageType)).toEqual(
      USAGE_TYPE_DISCOUNTS.regular,
    )
  })
})

describe("isMachineItem (issue #105)", () => {
  it("classifies items by explicit type, ignoring origin", () => {
    expect(isMachineItem({ type: "machine" })).toBe(true)
    expect(isMachineItem({ type: "material" })).toBe(false)
  })

  it("treats a missing type as material", () => {
    expect(isMachineItem({})).toBe(false)
    expect(isMachineItem({ type: null })).toBe(false)
  })
})


describe("usage type labels (issue #284)", () => {
  it("labels volunteering as Freiwilligengruppe", () => {
    expect(USAGE_TYPE_LABELS.volunteering).toBe("Freiwilligengruppe")
  })

  it("has a discount reason label for every discounted usage type", () => {
    for (const ut of Object.keys(USAGE_TYPE_DISCOUNTS) as UsageType[]) {
      const d = usageDiscount(ut)
      const discounted =
        d.entryFee < 1 || d.machine < 1 || d.material < 1 || d.tip < 1
      if (discounted) {
        expect(USAGE_DISCOUNT_LABELS[ut], `label for ${ut}`).toBeTruthy()
      }
    }
  })
})
