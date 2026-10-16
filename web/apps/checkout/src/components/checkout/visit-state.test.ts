// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest"
import { isStartedVisit } from "./visit-state"

describe("isStartedVisit", () => {
  it("is false without an open checkout", () => {
    expect(isStartedVisit(null)).toBe(false)
    expect(isStartedVisit(undefined)).toBe(false)
  })

  it("is false for a purchase-only (materialbezug) checkout", () => {
    expect(isStartedVisit({ usageType: "materialbezug" })).toBe(false)
  })

  it.each(["regular", "ermaessigt", "intern"])(
    "is true for a %s visit",
    (usageType) => {
      expect(isStartedVisit({ usageType })).toBe(true)
    },
  )

  it("treats a legacy doc without usageType as a visit", () => {
    expect(isStartedVisit({} as { usageType: string })).toBe(true)
  })
})
