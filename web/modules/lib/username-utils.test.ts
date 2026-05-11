// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest"
import { formatFullName } from "./username-utils"

describe("formatFullName", () => {
  it("joins first + last with a single space", () => {
    expect(formatFullName({ firstName: "Max", lastName: "Muster" })).toBe(
      "Max Muster"
    )
  })

  it("returns just firstName when lastName is missing", () => {
    expect(formatFullName({ firstName: "Max", lastName: "" })).toBe("Max")
    expect(formatFullName({ firstName: "Max", lastName: null })).toBe("Max")
    expect(formatFullName({ firstName: "Max" })).toBe("Max")
  })

  it("returns just lastName when firstName is missing", () => {
    expect(formatFullName({ firstName: "", lastName: "Muster" })).toBe("Muster")
    expect(formatFullName({ firstName: null, lastName: "Muster" })).toBe(
      "Muster"
    )
    expect(formatFullName({ lastName: "Muster" })).toBe("Muster")
  })

  it("returns the fallback when both names are empty/missing", () => {
    expect(
      formatFullName({ firstName: "", lastName: "" }, "fallback")
    ).toBe("fallback")
    expect(
      formatFullName({ firstName: null, lastName: null }, "user@example.com")
    ).toBe("user@example.com")
    expect(formatFullName({}, "Jemand")).toBe("Jemand")
  })

  it("returns an empty string when both names are empty and no fallback", () => {
    expect(formatFullName({ firstName: "", lastName: "" })).toBe("")
    expect(formatFullName({})).toBe("")
  })

  it("trims surrounding whitespace from inputs via the join", () => {
    // Whitespace-only inputs collapse to an empty fullname so the fallback
    // wins. Regression guard: an earlier draft used `.trim()` only on the
    // joined string, which still passed for `"   "` so this case is here
    // to keep the contract explicit.
    expect(
      formatFullName({ firstName: "   ", lastName: "   " }, "fallback")
    ).toBe("fallback")
  })

  it("preserves internal whitespace inside individual names", () => {
    // Compound names with spaces should round-trip intact.
    expect(
      formatFullName({ firstName: "Anne Marie", lastName: "von Muster" })
    ).toBe("Anne Marie von Muster")
  })
})
