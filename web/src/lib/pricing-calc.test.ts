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
