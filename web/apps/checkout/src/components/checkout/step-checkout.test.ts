// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest"
import { roundUpOptions, roundUpOptionLabel } from "./step-checkout"

describe("roundUpOptions", () => {
  it("returns empty for zero or negative base", () => {
    expect(roundUpOptions(0)).toEqual([])
    expect(roundUpOptions(-5)).toEqual([])
  })

  // When the base is already a whole franc there's nothing to round up,
  // so the suggestion row is hidden (regression for #204).
  it("returns empty for whole-franc bases", () => {
    expect(roundUpOptions(1)).toEqual([])
    expect(roundUpOptions(5)).toEqual([])
    expect(roundUpOptions(35)).toEqual([])
    expect(roundUpOptions(70)).toEqual([])
  })

  // --- New spec (#233) ---------------------------------------------------
  // The 5 CHF cap floor means tiny bases still offer the next franc, even
  // when that's a much larger relative jump than 10%.
  it("0.30 — tiny base offers a useful ladder of integer francs", () => {
    expect(roundUpOptions(0.3)).toEqual([0.5, 1, 2, 5])
  })

  it("3.20 — sub-5 base offers francs and next 5 (3.5 swallowed by 4)", () => {
    // 3.5 (d=0.5) is dominated by 4 (d=2) — gap is exactly the
    // dominance threshold (0.5) and the divisor ratio is 4×.
    expect(roundUpOptions(3.2)).toEqual([4, 5])
  })

  it("4.99 — close to 5 collapses everything to 5 (next 5 is also next 10 / 50)", () => {
    expect(roundUpOptions(4.99)).toEqual([5])
  })

  // 9.80 → 10 alone: every divisor on the ladder produces 10 at this base.
  it("9.80 collapses to the single natural target 10", () => {
    expect(roundUpOptions(9.8)).toEqual([10])
  })

  // 12.40 → multiple useful steps. Half-franc IS included now (the
  // `base < 5` gate was removed in #233 — the entry-count cap handles it).
  it("12.40 — half-franc, francs, and next 5 are all distinct steps", () => {
    expect(roundUpOptions(12.4)).toEqual([12.5, 13, 14, 15])
  })

  // 23.40 — the canonical small-bill case. 24 (d=2) survives because the
  // dominance filter only drops entries when a 4×-larger divisor is close
  // by; d=5 (next is 25, gap 1, base 23.40 → dominance threshold 1.17) is
  // close but 25 has d=5 which is < 4× d=2. So 24 stays.
  it("23.40 keeps both 24 and 25", () => {
    expect(roundUpOptions(23.4)).toEqual([24, 25])
  })

  it("42.30 keeps the 2-franc and 5-franc step", () => {
    expect(roundUpOptions(42.3)).toEqual([44, 45])
  })

  it("56.33 — next franc and next 10", () => {
    // 57 (d=1) stays because the gap to 60 (d=10) is 3 CHF, larger than
    // the dominance gap of max(0.5, 2.8) = 2.8.
    expect(roundUpOptions(56.33)).toEqual([57, 60])
  })

  // --- Magnitude-aware: the headline #233 fix --------------------------
  // (Use bases just above a whole franc — whole-franc bases short-circuit
  // to `[]`, by design, since there's nothing to round.)
  // 95.10 should propose 100, NOT 96. d=2 → 96 is dominated by d=100→100
  // (gap ≤ dominanceGap, divisor 50× larger).
  it("95.10 → [100] (no degenerate 96)", () => {
    expect(roundUpOptions(95.1)).toEqual([100])
  })

  // 195.20 should propose 200, NOT 196. Same dominance pattern.
  it("195.20 → [200] (no degenerate 196)", () => {
    expect(roundUpOptions(195.2)).toEqual([200])
  })

  // 247.10 — the monotonicity filter kicks in: 260 (d=20) is rejected
  // because 250 (d=50) comes before it with a larger divisor. Without
  // monotonicity we'd get the awkward [250, 260].
  it("247.10 → [250] (no monotonicity-violating 260)", () => {
    expect(roundUpOptions(247.1)).toEqual([250])
  })

  it("497.50 → [500]", () => {
    expect(roundUpOptions(497.5)).toEqual([500])
  })

  it("999.99 → [1000]", () => {
    expect(roundUpOptions(999.99)).toEqual([1000])
  })

  // --- Generic invariants -----------------------------------------------
  it("returns at most 4 options", () => {
    for (const base of [0.3, 1.01, 5.5, 12.4, 33.33, 56.33, 100.1, 999.99]) {
      expect(roundUpOptions(base).length).toBeLessThanOrEqual(4)
    }
  })

  it("all options are strictly greater than base and within the bump cap", () => {
    for (const base of [0.3, 3.2, 7.76, 15, 33.33, 56.33, 100.5, 247, 999]) {
      const cap = Math.max(5, base * 0.1)
      for (const o of roundUpOptions(base)) {
        expect(o).toBeGreaterThan(base)
        expect(o - base).toBeLessThanOrEqual(cap + 1e-9)
      }
    }
  })

  it("options are returned in strictly ascending order", () => {
    for (const base of [0.3, 3.2, 12.4, 23.4, 56.33, 247, 999]) {
      const opts = roundUpOptions(base)
      for (let i = 1; i < opts.length; i++) {
        expect(opts[i]).toBeGreaterThan(opts[i - 1]!)
      }
    }
  })

  it("never proposes a sub-1-CHF jump above a much rounder neighbour", () => {
    // The regression net for #233. For any base, no two suggestions
    // `c1 < c2` should have `(c2 - c1) <= 1 CHF` while `c2` is much
    // rounder than `c1` (divisor ratio ≥ 10). Property test sweeps the
    // 0–500 CHF range.
    const NEAR = 1.01 // tolerates rounding fuzz
    for (let base = 0.05; base < 500; base += 0.37) {
      const opts = roundUpOptions(base)
      for (let i = 0; i < opts.length - 1; i++) {
        const c1 = opts[i]!
        const c2 = opts[i + 1]!
        if (c2 - c1 > NEAR) continue
        // If c2 is at a multiple of 100 and c1 is the next franc below
        // it (the 95→[96,100] pattern), the algorithm must have dropped
        // c1. Assert that pattern never reappears.
        const c2RoundToHundred = c2 % 100 === 0
        const c1JustBelowFranc = Math.abs(c1 - (c2 - 1)) < 0.01
        expect(
          !(c2RoundToHundred && c1JustBelowFranc),
          `base=${base} produced degenerate [${c1}, ${c2}]`,
        ).toBe(true)
      }
    }
  })
})

describe("roundUpOptionLabel", () => {
  it("calls the smallest integer target the next franc", () => {
    expect(roundUpOptionLabel(7, true)).toBe("nächsten Franken")
  })

  it("calls a half-franc smallest target the next half franc", () => {
    expect(roundUpOptionLabel(3.5, true)).toBe("nächsten halben Franken")
    expect(roundUpOptionLabel(12.5, true)).toBe("nächsten halben Franken")
  })

  it("formats non-smallest integer targets as 'X Franken'", () => {
    expect(roundUpOptionLabel(40, false)).toBe("40 Franken")
    expect(roundUpOptionLabel(50, false)).toBe("50 Franken")
  })

  it("formats non-smallest half-franc targets with two decimals", () => {
    expect(roundUpOptionLabel(6.5, false)).toBe("6.50 Franken")
  })
})
