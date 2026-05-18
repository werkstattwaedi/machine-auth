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

  it("42.30 keeps the literal next franc, 2-franc and 5-franc step", () => {
    // Issue #249 — dominance must not swallow the literal next whole
    // franc (43) just because 45 (d=5) is within the dominance gap.
    // The closely-adjacent rule keeps suppressing the awkward `[N-1, N]`
    // pattern, but 43 → 45 has a 2 CHF gap, comfortably > 1.
    expect(roundUpOptions(42.3)).toEqual([43, 44, 45])
  })

  it("56.33 — next franc and next 10", () => {
    // 57 (d=1) stays because the gap to 60 (d=10) is 3 CHF, larger than
    // the dominance gap of max(0.5, 2.8) = 2.8.
    expect(roundUpOptions(56.33)).toEqual([57, 60])
  })

  // Issue #249 regression line — the user reported that a base of
  // CHF 66.32 was offered only "auf nächsten Franken — +CHF 3.68" (target
  // 70). The literal next franc is 67, a 0.68 CHF bump; it must stay in
  // the option set so the user can pick it.
  it("66.32 → [67, 70] (literal next franc preserved, issue #249)", () => {
    expect(roundUpOptions(66.32)).toEqual([67, 70])
    expect(roundUpOptions(66.32)[0]).toBe(67)
  })

  // --- Magnitude-aware: the headline #233 fix --------------------------
  // (Use bases just above a whole franc — whole-franc bases short-circuit
  // to `[]`, by design, since there's nothing to round.)
  // After the #249 relaxation, the literal next franc (96) is preserved
  // alongside the rounder 100 — only the closely-adjacent `[99, 100]`
  // pattern is still suppressed.
  it("95.10 → [96, 100] (literal next franc + next 100)", () => {
    expect(roundUpOptions(95.1)).toEqual([96, 100])
  })

  it("195.20 → [196, 200] (literal next franc + next 100)", () => {
    expect(roundUpOptions(195.2)).toEqual([196, 200])
  })

  // 247.10 — the literal next franc (248) survives; 250 (d=50) is the
  // natural next-50 target. 260 (d=20) is then dropped by the
  // monotonicity filter (d=20 < running max d=50).
  it("247.10 → [248, 250] (next franc + next 50, 260 dropped by monotonicity)", () => {
    expect(roundUpOptions(247.1)).toEqual([248, 250])
  })

  it("497.50 → [498, 500] (literal next franc + next 100)", () => {
    expect(roundUpOptions(497.5)).toEqual([498, 500])
  })

  // The closely-adjacent rule still drops the literal next franc when
  // its rounder neighbour is exactly 1 CHF above (the `[199, 200]` /
  // `[99, 100]` pattern that motivated #233).
  it("198.50 → [200] (closely-adjacent 199 dropped)", () => {
    expect(roundUpOptions(198.5)).toEqual([200])
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
  it("calls the smallest integer target the next franc when delta ≤ 1", () => {
    // base 6.30 → target 7, delta 0.70 — fits "next franc".
    expect(roundUpOptionLabel(7, 6.3, true)).toBe("nächsten Franken")
  })

  it("calls a half-franc smallest target the next half franc when delta ≤ 0.5", () => {
    expect(roundUpOptionLabel(3.5, 3.2, true)).toBe("nächsten halben Franken")
    expect(roundUpOptionLabel(12.5, 12.1, true)).toBe("nächsten halben Franken")
  })

  // Issue #249 — when the dominance filter still drops the literal next
  // franc (e.g. base 198.50 → smallest option 200), the label MUST fall
  // through to the explicit "X Franken" form. Otherwise the UI claims
  // "nächsten Franken" for a 1.50 CHF bump, which is the bug.
  it("falls through to 'X Franken' when the smallest delta exceeds 1 CHF", () => {
    expect(roundUpOptionLabel(200, 198.5, true)).toBe("200 Franken")
    expect(roundUpOptionLabel(70, 66.32, true)).toBe("70 Franken")
  })

  it("falls through to 'X.YY Franken' when a half-franc delta exceeds 0.5", () => {
    // base 13 → target 13.5, delta 0.5 — still fits "half franc".
    expect(roundUpOptionLabel(13.5, 13, true)).toBe("nächsten halben Franken")
    // base 12.4 → target 13.5 would be delta 1.1 — too large for "half
    // franc" copy.
    expect(roundUpOptionLabel(13.5, 12.4, true)).toBe("13.50 Franken")
  })

  it("formats non-smallest integer targets as 'X Franken'", () => {
    expect(roundUpOptionLabel(40, 35.1, false)).toBe("40 Franken")
    expect(roundUpOptionLabel(50, 35.1, false)).toBe("50 Franken")
  })

  it("formats non-smallest half-franc targets with two decimals", () => {
    expect(roundUpOptionLabel(6.5, 5.2, false)).toBe("6.50 Franken")
  })
})
