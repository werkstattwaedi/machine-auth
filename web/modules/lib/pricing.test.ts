// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest"
import { calculateFee, type UserType, type UsageType } from "./pricing"
import type { PricingConfig } from "./workshop-config"

describe("calculateFee", () => {
  describe("with config", () => {
    const config: PricingConfig = {
      entryFees: {
        erwachsen: { regular: 20, materialbezug: 5, intern: 0, hangenmoos: 25 },
        kind: { regular: 10, materialbezug: 0, intern: 0, hangenmoos: 10 },
        firma: { regular: 50, materialbezug: 10, intern: 0, hangenmoos: 50 },
      },
      slaLayerPrice: { none: 0.01, member: 0.008, intern: 0.006 },
      workshops: {} as PricingConfig["workshops"],
      labels: {} as PricingConfig["labels"],
    }

    it.each([
      ["erwachsen", "regular", 20],
      ["erwachsen", "materialbezug", 5],
      ["kind", "regular", 10],
      ["kind", "materialbezug", 0],
      ["firma", "hangenmoos", 50],
    ] as [UserType, UsageType, number][])(
      "returns the configured fee for %s + %s",
      (userType, usageType, expected) => {
        expect(calculateFee(userType, usageType, config)).toBe(expected)
      },
    )
  })

  describe("issue #149: fail loud on missing config", () => {
    // Issue #149: the previous implementation silently substituted hardcoded
    // fallback fees when `config/pricing` was missing, hiding misconfiguration
    // until month-end reconciliation. The contract is now: callers receive
    // null, must surface that as a visible error to staff.
    it("returns null when config is null", () => {
      expect(calculateFee("erwachsen", "regular", null)).toBeNull()
    })

    it("returns null when config is undefined", () => {
      expect(calculateFee("erwachsen", "regular", undefined)).toBeNull()
    })

    it("returns null when entryFees is missing entirely", () => {
      const config = {
        workshops: {},
        labels: {},
      } as unknown as PricingConfig
      expect(calculateFee("erwachsen", "regular", config)).toBeNull()
    })

    it("returns null when the user type row is missing", () => {
      const config = {
        entryFees: {
          erwachsen: { regular: 20, materialbezug: 5, intern: 0, hangenmoos: 25 },
        },
      } as unknown as PricingConfig
      expect(calculateFee("kind", "regular", config)).toBeNull()
    })

    it("returns null when the usage type column is missing", () => {
      const config = {
        entryFees: {
          erwachsen: { regular: 20 },
        },
      } as unknown as PricingConfig
      // "materialbezug" not in row → null
      expect(calculateFee("erwachsen", "materialbezug", config)).toBeNull()
    })

    it("preserves explicit zero (not coerced to null)", () => {
      const config = {
        entryFees: {
          erwachsen: { regular: 0, materialbezug: 0, intern: 0, hangenmoos: 0 },
        },
      } as unknown as PricingConfig
      expect(calculateFee("erwachsen", "regular", config)).toBe(0)
    })
  })
})
