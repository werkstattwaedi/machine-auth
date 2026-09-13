// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest"
import { withEnvLabel } from "./env-label"

describe("withEnvLabel", () => {
  it("returns the title unchanged when no label is configured", () => {
    expect(withEnvLabel(undefined, "OWW Administration")).toBe("OWW Administration")
    expect(withEnvLabel(null, "OWW Administration")).toBe("OWW Administration")
    expect(withEnvLabel("", "OWW Administration")).toBe("OWW Administration")
    expect(withEnvLabel("   ", "OWW Administration")).toBe("OWW Administration")
  })

  it("prefixes the title with the label and a single space", () => {
    expect(withEnvLabel("[staging]", "OWW Self Checkout")).toBe(
      "[staging] OWW Self Checkout"
    )
  })

  it("trims whitespace around the label", () => {
    expect(withEnvLabel("  [local] ", "Offene Werkstatt Wädenswil")).toBe(
      "[local] Offene Werkstatt Wädenswil"
    )
  })
})
