// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest"
import { roundUpOptions } from "./step-checkout"

describe("roundUpOptions", () => {
  it("returns empty for zero or negative", () => {
    expect(roundUpOptions(0)).toEqual([])
    expect(roundUpOptions(-5)).toEqual([])
  })

  // Small amounts (<10): include half-franc steps, max = base + 3
  it("5.00 → 5.50, 6", () => {
    expect(roundUpOptions(5.0)).toEqual([5.5, 6])
  })

  it("6.33 → 6.50, 7, 8", () => {
    expect(roundUpOptions(6.33)).toEqual([6.5, 7, 8])
  })

  it("7.50 → 8, 10", () => {
    expect(roundUpOptions(7.5)).toEqual([8, 10])
  })

  it("9.80 → 10", () => {
    expect(roundUpOptions(9.8)).toEqual([10])
  })

  // Medium amounts (10–50): no half-francs, max = base * 1.1
  it("15.00 → 16", () => {
    expect(roundUpOptions(15.0)).toEqual([16])
  })

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

  it("50.00 → 51, 52, 55", () => {
    expect(roundUpOptions(50.0)).toEqual([51, 52, 55])
  })

  it("98.50 → 99, 100", () => {
    expect(roundUpOptions(98.5)).toEqual([99, 100])
  })

  // Edge cases
  it("returns at most 3 options", () => {
    const opts = roundUpOptions(1.01)
    expect(opts.length).toBeLessThanOrEqual(3)
  })

  it("all options are strictly greater than base", () => {
    for (const base of [5, 7.76, 15, 33.33, 56.33, 100]) {
      for (const o of roundUpOptions(base)) {
        expect(o).toBeGreaterThan(base)
      }
    }
  })

  it("all options are within max tip threshold", () => {
    for (const base of [5, 7.76, 15, 33.33, 56.33, 100]) {
      const maxTotal = base < 10 ? base + 3 : base * 1.1
      for (const o of roundUpOptions(base)) {
        expect(o).toBeLessThanOrEqual(maxTotal)
      }
    }
  })
})
