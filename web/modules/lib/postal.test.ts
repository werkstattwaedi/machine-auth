// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest"
import { isValidSwissPlz } from "./postal"

describe("isValidSwissPlz", () => {
  it("accepts PLZ inside the standard 1000-9699 band", () => {
    expect(isValidSwissPlz("8820")).toBe(true) // Wädenswil
    expect(isValidSwissPlz("1000")).toBe(true) // band lower bound
    expect(isValidSwissPlz("9699")).toBe(true) // band upper bound
    expect(isValidSwissPlz("8001")).toBe(true) // Zurich
    expect(isValidSwissPlz("9490")).toBe(true) // Vaduz (FL — round-trips via CH Post)
  })

  it("rejects PLZ outside the 1000-9699 band", () => {
    expect(isValidSwissPlz("0999")).toBe(false)
    expect(isValidSwissPlz("0001")).toBe(false)
    expect(isValidSwissPlz("9700")).toBe(false)
    expect(isValidSwissPlz("9999")).toBe(false)
  })

  it("rejects wrong-length input", () => {
    expect(isValidSwissPlz("")).toBe(false)
    expect(isValidSwissPlz("88")).toBe(false)
    expect(isValidSwissPlz("882")).toBe(false)
    expect(isValidSwissPlz("88200")).toBe(false)
  })

  it("rejects non-numeric input", () => {
    expect(isValidSwissPlz("abc")).toBe(false)
    expect(isValidSwissPlz("erpw")).toBe(false) // from issue #298 screenshot
    expect(isValidSwissPlz("88a0")).toBe(false)
    expect(isValidSwissPlz("12.0")).toBe(false)
  })

  it("trims whitespace before validating", () => {
    expect(isValidSwissPlz(" 8820 ")).toBe(true)
    expect(isValidSwissPlz("  ")).toBe(false)
  })
})
