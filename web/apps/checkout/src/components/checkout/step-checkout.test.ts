// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest"
import { roundUpOptions, roundUpOptionLabel } from "./step-checkout"

describe("roundUpOptions", () => {
  it("returns empty for zero or negative base", () => {
    expect(roundUpOptions(0)).toEqual([])
    expect(roundUpOptions(-5)).toEqual([])
  })

  // Tiny totals (< 5): include 0.50 step + integer francs
  it("3.20 → 3.50, 4, 5", () => {
    expect(roundUpOptions(3.2)).toEqual([3.5, 4, 5])
  })

  it("4.99 → 5, 6", () => {
    expect(roundUpOptions(4.99)).toEqual([5, 6])
  })

  // Small totals (5–10): no half-francs, max = base + 3
  it("6.33 → 7, 8", () => {
    expect(roundUpOptions(6.33)).toEqual([7, 8])
  })

  it("9.80 → 10", () => {
    expect(roundUpOptions(9.8)).toEqual([10])
  })

  // Medium totals (10–50): max = base * 1.1
  it("23.40 → 24, 25", () => {
    expect(roundUpOptions(23.4)).toEqual([24, 25])
  })

  it("42.30 → 43, 44, 45", () => {
    expect(roundUpOptions(42.3)).toEqual([43, 44, 45])
  })

  // Larger amounts: integers/5/10
  it("56.33 → 57, 58, 60", () => {
    expect(roundUpOptions(56.33)).toEqual([57, 58, 60])
  })

  it("returns at most 3 options", () => {
    for (const base of [1.01, 5.5, 33.33, 56.33, 100]) {
      expect(roundUpOptions(base).length).toBeLessThanOrEqual(3)
    }
  })

  it("all options are strictly greater than base and within max threshold", () => {
    for (const base of [3.2, 7.76, 15, 33.33, 56.33, 100]) {
      const max = base < 10 ? base + 3 : base * 1.1
      for (const o of roundUpOptions(base)) {
        expect(o).toBeGreaterThan(base)
        expect(o).toBeLessThanOrEqual(max)
      }
    }
  })
})

describe("roundUpOptionLabel", () => {
  it("calls the smallest integer target the next franc", () => {
    expect(roundUpOptionLabel(7, true)).toBe("nächsten Franken")
  })

  it("calls a tiny 0.50-step target the next half franc", () => {
    expect(roundUpOptionLabel(3.5, true)).toBe("nächsten halben Franken")
  })

  it("formats non-first-step targets as 'X Franken'", () => {
    expect(roundUpOptionLabel(40, false)).toBe("40 Franken")
    expect(roundUpOptionLabel(50, false)).toBe("50 Franken")
  })
})
