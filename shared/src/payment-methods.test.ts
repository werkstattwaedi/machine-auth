// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest"
import {
  PAYMENT_METHODS,
  isPaidDuringCheckout,
  normalizePaidVia,
  normalizePaymentMethod,
} from "./payment-methods"

describe("normalizePaymentMethod", () => {
  it("passes current ids through", () => {
    for (const m of PAYMENT_METHODS) expect(normalizePaymentMethod(m)).toBe(m)
  })

  it("maps the pre-rename twint id to raisenow", () => {
    expect(normalizePaymentMethod("twint")).toBe("raisenow")
  })

  it("returns null for anything else", () => {
    expect(normalizePaymentMethod(null)).toBeNull()
    expect(normalizePaymentMethod(undefined)).toBeNull()
    expect(normalizePaymentMethod("")).toBeNull()
    expect(normalizePaymentMethod("cash")).toBeNull()
    expect(normalizePaymentMethod(42)).toBeNull()
    // Object prototype keys must not resolve through the alias table.
    expect(normalizePaymentMethod("toString")).toBeNull()
  })
})

describe("isPaidDuringCheckout", () => {
  it("is true for raisenow, including the legacy id", () => {
    expect(isPaidDuringCheckout("raisenow")).toBe(true)
    expect(isPaidDuringCheckout("twint")).toBe(true)
  })

  it("is false for invoiced methods and unknown values", () => {
    expect(isPaidDuringCheckout("rechnung")).toBe(false)
    expect(isPaidDuringCheckout("monthly")).toBe(false)
    expect(isPaidDuringCheckout(null)).toBe(false)
  })
})

describe("normalizePaidVia", () => {
  it("maps legacy twint to raisenow and keeps current values", () => {
    expect(normalizePaidVia("twint")).toBe("raisenow")
    expect(normalizePaidVia("raisenow")).toBe("raisenow")
    expect(normalizePaidVia("ebanking")).toBe("ebanking")
    expect(normalizePaidVia("free")).toBe("free")
  })

  it("returns null for cash and unknown values", () => {
    expect(normalizePaidVia("cash")).toBeNull()
    expect(normalizePaidVia(null)).toBeNull()
    expect(normalizePaidVia("constructor")).toBeNull()
  })
})
