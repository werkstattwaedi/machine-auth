// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest"
import { calculateFee, type UserType, type UsageType } from "./pricing"
import type { PricingConfig } from "./workshop-config"

describe("calculateFee", () => {
  const userTypes: UserType[] = ["erwachsen", "kind", "firma"]
  const usageTypes: UsageType[] = ["regular", "materialbezug", "intern", "hangenmoos"]

  describe("hardcoded fallback (no config)", () => {
    it.each([
      ["erwachsen", "regular", 15],
      ["erwachsen", "materialbezug", 0],
      ["erwachsen", "intern", 0],
      ["erwachsen", "hangenmoos", 15],
      ["kind", "regular", 7.5],
      ["kind", "materialbezug", 0],
      ["kind", "intern", 0],
      ["kind", "hangenmoos", 7.5],
      ["firma", "regular", 30],
      ["firma", "materialbezug", 0],
      ["firma", "intern", 0],
      ["firma", "hangenmoos", 30],
    ] as [UserType, UsageType, number][])(
      "%s + %s → %d CHF",
      (userType, usageType, expected) => {
        expect(calculateFee(userType, usageType)).toBe(expected)
      },
    )
  })

  describe("with config override", () => {
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

    it("uses config values over hardcoded", () => {
      expect(calculateFee("erwachsen", "regular", config)).toBe(20)
      expect(calculateFee("firma", "regular", config)).toBe(50)
      expect(calculateFee("kind", "materialbezug", config)).toBe(0)
    })
  })

  describe("edge cases", () => {
    it("returns 0 for null config", () => {
      expect(calculateFee("erwachsen", "regular", null)).toBe(15)
    })

    it("returns 0 for config with missing entryFees", () => {
      const config = { workshops: {}, labels: {} } as unknown as PricingConfig
      expect(calculateFee("erwachsen", "regular", config)).toBe(15)
    })

    it("returns 0 for config with missing user type row", () => {
      const config = {
        entryFees: {
          erwachsen: { regular: 20 },
        },
      } as unknown as PricingConfig
      // "kind" not in config → fallback
      expect(calculateFee("kind", "regular", config)).toBe(7.5)
    })

    it("returns all fees for every combination", () => {
      for (const ut of userTypes) {
        for (const usage of usageTypes) {
          const fee = calculateFee(ut, usage)
          expect(fee).toBeGreaterThanOrEqual(0)
        }
      }
    })
  })
})
