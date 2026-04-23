// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest"
import { computePricing } from "./pricing-calc"

describe("computePricing", () => {
  describe("area pricing", () => {
    it("calculates m² from cm dimensions", () => {
      const result = computePricing("area", 10, { lengthCm: 200, widthCm: 50 })
      // 2m × 0.5m = 1m², 1 × 10 = 10
      expect(result.quantity).toBe(1)
      expect(result.totalPrice).toBe(10)
      expect(result.formInputs).toEqual([
        { quantity: 200, unit: "cm" },
        { quantity: 50, unit: "cm" },
      ])
    })

    it("handles zero dimensions", () => {
      const result = computePricing("area", 10, { lengthCm: 0, widthCm: 100 })
      expect(result.quantity).toBe(0)
      expect(result.totalPrice).toBe(0)
    })

    it("handles missing dimensions", () => {
      const result = computePricing("area", 10, {})
      expect(result.quantity).toBe(0)
      expect(result.totalPrice).toBe(0)
    })
  })

  describe("length pricing", () => {
    it("calculates meters from cm", () => {
      const result = computePricing("length", 5, { lengthCm: 300 })
      // 3m × 5 = 15
      expect(result.quantity).toBe(3)
      expect(result.totalPrice).toBe(15)
      expect(result.formInputs).toEqual([{ quantity: 300, unit: "cm" }])
    })

    it("handles fractional meters", () => {
      const result = computePricing("length", 10, { lengthCm: 150 })
      expect(result.quantity).toBe(1.5)
      expect(result.totalPrice).toBe(15)
    })
  })

  describe("weight pricing", () => {
    it("calculates kg from grams", () => {
      const result = computePricing("weight", 20, { weightG: 500 })
      // 0.5kg × 20 = 10
      expect(result.quantity).toBe(0.5)
      expect(result.totalPrice).toBe(10)
      expect(result.formInputs).toEqual([{ quantity: 500, unit: "g" }])
    })
  })

  describe("count pricing", () => {
    it("multiplies quantity × unit price", () => {
      const result = computePricing("count", 3, { quantity: 5 })
      expect(result.quantity).toBe(5)
      expect(result.totalPrice).toBe(15)
      expect(result.formInputs).toEqual([{ quantity: 5, unit: "Stk." }])
    })
  })

  describe("time pricing", () => {
    it("multiplies hours × unit price", () => {
      const result = computePricing("time", 15, { quantity: 2 })
      expect(result.quantity).toBe(2)
      expect(result.totalPrice).toBe(30)
      expect(result.formInputs).toEqual([{ quantity: 2, unit: "h" }])
    })
  })

  describe("direct pricing", () => {
    it("uses quantity as direct CHF amount", () => {
      const result = computePricing("direct", 0, { quantity: 42.5 })
      expect(result.quantity).toBe(1)
      expect(result.totalPrice).toBe(42.5)
      expect(result.formInputs).toBeUndefined()
    })
  })

  describe("sla pricing", () => {
    it("combines resin volume (per liter) and layer count", () => {
      const result = computePricing(
        "sla",
        0,
        { resinMl: 50, layers: 1000 },
        { resinPricePerLiter: 250, pricePerLayer: 0.01 },
      )
      // (50/1000)*250 = 12.5; 1000 * 0.01 = 10; total = 22.5
      expect(result.quantity).toBe(1)
      expect(result.totalPrice).toBe(22.5)
      expect(result.formInputs).toEqual([
        { quantity: 50, unit: "ml" },
        { quantity: 1000, unit: "layers" },
      ])
    })

    it("returns only resin cost when layers is zero", () => {
      const result = computePricing(
        "sla",
        0,
        { resinMl: 50, layers: 0 },
        { resinPricePerLiter: 250, pricePerLayer: 0.01 },
      )
      expect(result.totalPrice).toBe(12.5)
    })

    it("returns only layer cost when resin volume is zero", () => {
      const result = computePricing(
        "sla",
        0,
        { resinMl: 0, layers: 1000 },
        { resinPricePerLiter: 250, pricePerLayer: 0.01 },
      )
      expect(result.totalPrice).toBe(10)
    })

    it("returns zero when both axes are zero", () => {
      const result = computePricing(
        "sla",
        0,
        { resinMl: 0, layers: 0 },
        { resinPricePerLiter: 250, pricePerLayer: 0.01 },
      )
      expect(result.totalPrice).toBe(0)
      expect(result.quantity).toBe(1)
    })

    it("rounds fractional totals to 2 decimal places", () => {
      // 13.7 ml * 250 CHF/L = 3.425 → rounded to 3.43 (Banker isn't used;
      // Math.round rounds half up for positive values).
      const result = computePricing(
        "sla",
        0,
        { resinMl: 13.7, layers: 0 },
        { resinPricePerLiter: 250, pricePerLayer: 0.01 },
      )
      expect(result.totalPrice).toBe(3.43)
    })

    it("treats missing slaPricing as zero cost", () => {
      const result = computePricing("sla", 0, { resinMl: 50, layers: 1000 })
      expect(result.totalPrice).toBe(0)
    })
  })

  describe("rounding", () => {
    it("rounds to 2 decimal places", () => {
      // 333cm × 33cm = 3.33m × 0.33m = 1.0989m², ×10 = 10.989 → 10.99
      const result = computePricing("area", 10, { lengthCm: 333, widthCm: 33 })
      expect(result.totalPrice).toBe(10.99)
    })

    it("handles clean results without extra decimals", () => {
      const result = computePricing("count", 5, { quantity: 2 })
      expect(result.totalPrice).toBe(10)
    })
  })
})
