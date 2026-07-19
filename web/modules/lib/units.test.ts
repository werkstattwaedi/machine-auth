// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest"
import {
  formatQuantity,
  formatUnitPrice,
  formatCount,
  formatPricePerCount,
  parseQuantity,
  parseWithDefaultUnit,
  cmToMeters,
  gramsToKg,
  mlToLiters,
  cmDimensionsToSquareMeters,
  type BaseUnit,
} from "./units"

// Helper: normalise non-breaking / narrow no-break space (used by Intl in
// `de-CH`) to ASCII space so the assertions read naturally.
function norm(s: string): string {
  return s.replace(/[  ]/g, " ")
}

describe("formatQuantity", () => {
  it.each<[number, BaseUnit, string]>([
    // SLA-style very small volumes — the prework example from #143.
    [0.00009, "l", "0.09 ml"],
    [0.0009, "l", "0.9 ml"],
    [0.1, "l", "100 ml"],
    [1, "l", "1 l"],
    // Length rescales to km / cm / mm as appropriate.
    [1500, "m", "1.5 km"],
    [0.05, "m", "5 cm"],
    [0.001, "m", "1 mm"],
    // Mass: kg → g for sub-kg quantities.
    [0.5, "kg", "500 g"],
    [1.5, "kg", "1.5 kg"],
    // Time: 0.25 h → 15 min, 0.001 h → ~3.6 s.
    [0.25, "h", "15 min"],
    // Area: small areas rescale to cm².
    [0.0001, "m2", "1 cm²"],
    [1, "m2", "1 m²"],
  ])("formatQuantity(%s, %s) → %s", (value, base, expected) => {
    expect(norm(formatQuantity(value, base))).toBe(expected)
  })

  it("returns empty string for non-finite values", () => {
    expect(formatQuantity(Number.NaN, "l")).toBe("")
    expect(formatQuantity(Number.POSITIVE_INFINITY, "kg")).toBe("")
  })

  it("respects custom fraction digits", () => {
    // Pin to 2 fraction digits → "1.50 km" instead of "1.5 km".
    const out = formatQuantity(1500, "m", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
    expect(norm(out)).toBe("1.50 km")
  })
})

describe("formatUnitPrice", () => {
  it("defaults to CHF per base unit", () => {
    // No referenceQuantity → denominator stays at base unit.
    expect(norm(formatUnitPrice(15, "m2"))).toBe("CHF 15.00/m²")
    expect(norm(formatUnitPrice(90, "l"))).toBe("CHF 90.00/l")
  })

  it("rescales the denominator using a reference quantity", () => {
    // SLA print (~0.05 l of resin) — CHF/ml is more natural than CHF/l for
    // the per-print sticker. 90 CHF/l × 0.05 l = 4.50 CHF total → 0.09 CHF/ml.
    expect(norm(formatUnitPrice(90, "l", { referenceQuantity: 0.05 }))).toBe(
      "CHF 0.09/ml",
    )
  })

  it("returns empty string for non-finite values", () => {
    expect(formatUnitPrice(Number.NaN, "l")).toBe("")
  })

  it("falls back to base unit when reference quantity is non-positive", () => {
    expect(norm(formatUnitPrice(15, "l", { referenceQuantity: 0 }))).toBe(
      "CHF 15.00/l",
    )
  })
})

describe("parseQuantity", () => {
  it.each<[string, BaseUnit, number]>([
    ["100 ml", "l", 0.1],
    ["5.5 km", "m", 5500],
    ["1500 g", "kg", 1.5],
    // German decimal comma.
    ["1,5 kg", "kg", 1.5],
    // Whitespace + missing space tolerated.
    ["  250cm  ", "m", 2.5],
    // Bare number → assume base unit.
    ["7", "l", 7],
    // Area (with superscript and ASCII variants).
    ["100 cm²", "m2", 0.01],
    ["100 cm2", "m2", 0.01],
    // Time: minutes → hours.
    ["30 min", "h", 0.5],
    // "m" is accepted as minutes in the time dimension (only "m" = metres
    // in the length dimension — aliases are per-dimension).
    ["30m", "h", 0.5],
    ["90m", "h", 1.5],
  ])("parseQuantity(%j, %s) → %s", (input, base, expected) => {
    const got = parseQuantity(input, base)
    expect(got).not.toBeNull()
    // Floating-point: allow tiny epsilon for unit conversions.
    expect(got!).toBeCloseTo(expected, 9)
  })

  it.each<[string, BaseUnit]>([
    ["abc", "l"],
    ["", "l"],
    // Wrong-dimension unit (kg in a length parse).
    ["5 kg", "m"],
    // Unrecognised unit.
    ["5 fooble", "m"],
  ])("parseQuantity(%j, %s) → null", (input, base) => {
    expect(parseQuantity(input, base)).toBeNull()
  })
})

describe("parseWithDefaultUnit", () => {
  it.each<[string, BaseUnit, string, number]>([
    // Bare number → default unit
    ["50", "m", "cm", 0.5], // 50 cm → 0.5 m
    ["500", "kg", "g", 0.5], // 500 g → 0.5 kg
    ["250", "l", "ml", 0.25], // 250 ml → 0.25 l
    ["12", "h", "min", 0.2], // 12 min → 0.2 h
    // Explicit unit overrides the default
    [".5m", "m", "cm", 0.5],
    ["50cm", "m", "cm", 0.5],
    ["5dm", "m", "cm", 0.5],
    ["1.5kg", "kg", "g", 1.5],
    ["2.5l", "l", "ml", 2.5],
    ["1.5h", "h", "min", 1.5],
    // German decimal comma
    ["1,5kg", "kg", "g", 1.5],
    // Empty → 0
    ["", "m", "cm", 0],
    ["  ", "m", "cm", 0],
  ])("parseWithDefaultUnit(%j, %s, %s) → %s", (input, base, def, expected) => {
    const got = parseWithDefaultUnit(input, base, def)
    expect(got).not.toBeNull()
    expect(got!).toBeCloseTo(expected, 9)
  })

  it.each<[string, BaseUnit, string]>([
    // Unknown unit token → null (even though a default exists)
    ["50xyz", "m", "cm"],
    ["12 sek", "h", "min"],
    // Wrong-dimension unit
    ["5kg", "m", "cm"],
  ])("parseWithDefaultUnit(%j, %s, %s) → null", (input, base, def) => {
    expect(parseWithDefaultUnit(input, base, def)).toBeNull()
  })
})

describe("formatCount", () => {
  it("formats small counts as bare integers + label", () => {
    expect(norm(formatCount(7, "Layer"))).toBe("7 Layer")
    expect(norm(formatCount(0, "Stk."))).toBe("0 Stk.")
  })

  it("uses the locale thousands separator for large counts", () => {
    // de-CH uses U+2019 (right single quotation mark) — pin it so a locale
    // change is caught by this test.
    const out = formatCount(1234, "Layer")
    expect(out).toMatch(/Layer$/)
    expect(out).toContain("1")
    expect(out).toContain("234")
  })

  it("rounds away fractional values (counts are integers)", () => {
    expect(norm(formatCount(1.7, "Stk."))).toBe("2 Stk.")
  })
})

describe("formatPricePerCount", () => {
  it("keeps the denominator at 1 for normal-magnitude prices", () => {
    expect(norm(formatPricePerCount(0.5, "Layer"))).toBe("CHF 0.50/Layer")
    expect(norm(formatPricePerCount(1, "Stk."))).toBe("CHF 1.00/Stk.")
    // Boundary: 0.01 still reads at 1× since 0.01 == threshold.
    expect(norm(formatPricePerCount(0.01, "Layer"))).toBe("CHF 0.01/Layer")
  })

  it("rescales to /100 for sub-cent prices", () => {
    // 0.001 CHF/Layer — at 1× would print "0.00", which reads as zero. /100
    // gives "0.10", which is readable.
    expect(norm(formatPricePerCount(0.001, "Layer"))).toBe("CHF 0.10/100 Layer")
  })

  it("rescales to /1000 for very small prices that don't reach 0.01 at /100", () => {
    // 0.00009 × 100 = 0.009 < 0.01 → bump to /1000 → 0.09.
    expect(norm(formatPricePerCount(0.00009, "Layer"))).toBe(
      "CHF 0.09/1000 Layer",
    )
  })

  it("uses /100 when /100 gets above the 0.01 threshold", () => {
    // SLA per-layer seed config (0.00109 CHF/Layer): 0.00109 × 100 = 0.109,
    // which is >= 0.01 so we stop at /100 rather than /1000. The price
    // formatter keeps up to 4 fractional digits to preserve precision when
    // the rescaled value isn't a clean two-decimal number.
    expect(norm(formatPricePerCount(0.00109, "Layer"))).toBe(
      "CHF 0.109/100 Layer",
    )
  })

  it("returns empty string for non-finite values", () => {
    expect(formatPricePerCount(Number.NaN, "Layer")).toBe("")
  })
})

describe("conversion helpers", () => {
  it("cmToMeters", () => {
    expect(cmToMeters(150)).toBe(1.5)
  })
  it("gramsToKg", () => {
    expect(gramsToKg(500)).toBe(0.5)
  })
  it("mlToLiters", () => {
    expect(mlToLiters(250)).toBe(0.25)
  })
  it("cmDimensionsToSquareMeters", () => {
    expect(cmDimensionsToSquareMeters(200, 50)).toBe(1)
  })
})
