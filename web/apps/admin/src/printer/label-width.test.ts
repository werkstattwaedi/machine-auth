// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Guards the label's physical length against a double-scaling regression:
 * `widthMm` must convert to dots at the head's true 360 DPI, NOT through
 * the vertical `px()` squeeze (which fits the 18 mm design into the
 * ~16.5 mm printable window and is correct only on the pin axis). The
 * screenshot test can't catch this on its own — it only diffs one
 * computed render against another — so this asserts the exact dot count.
 */

import { describe, it, expect } from "vitest"
import { labelWidthDots } from "./render-material-label"

describe("labelWidthDots", () => {
  it("converts millimetres to dots at the head's true 360 DPI", () => {
    // 72 mm × 360 / 25.4 = 1020.47 → 1020 dots. (The double-scaled bug
    // produced 938 — an ~8 % short 66 mm label.)
    expect(labelWidthDots(72)).toBe(1020)
  })

  it("scales linearly with the configured length", () => {
    expect(labelWidthDots(48)).toBe(680)
    expect(labelWidthDots(96)).toBe(1361)
  })
})
