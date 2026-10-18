// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest"
import {
  PAYMENT_METHODS,
  enabledPaymentMethods,
  isPaidDuringCheckout,
  isPaymentMethodEnabledAnywhere,
  isPaymentMethod,
  parsePaymentMethodList,
} from "./payment-methods"

describe("isPaymentMethod", () => {
  it("accepts the current ids only", () => {
    for (const m of PAYMENT_METHODS) expect(isPaymentMethod(m)).toBe(true)
    // The pre-rename id is gone for good (ADR-0044); "cash" never was a method.
    expect(isPaymentMethod("twint")).toBe(false)
    expect(isPaymentMethod("cash")).toBe(false)
    expect(isPaymentMethod(null)).toBe(false)
    expect(isPaymentMethod("toString")).toBe(false)
  })
})

describe("isPaidDuringCheckout", () => {
  it("is true for the methods paid on the spot", () => {
    expect(isPaidDuringCheckout("raisenow")).toBe(true)
    expect(isPaidDuringCheckout("wallee_terminal")).toBe(true)
    expect(isPaidDuringCheckout("rechnung")).toBe(false)
    expect(isPaidDuringCheckout("monthly")).toBe(false)
    expect(isPaidDuringCheckout(null)).toBe(false)
  })
})

describe("parsePaymentMethodList", () => {
  it("falls back to the defaults when unset or empty", () => {
    expect(parsePaymentMethodList(undefined)).toEqual(["rechnung", "monthly", "raisenow"])
    expect(parsePaymentMethodList("")).toEqual(["rechnung", "monthly", "raisenow"])
    expect(parsePaymentMethodList(" , ")).toEqual(["rechnung", "monthly", "raisenow"])
  })

  it("keeps the configured order and drops duplicates", () => {
    expect(parsePaymentMethodList(" raisenow, rechnung ,raisenow")).toEqual([
      "raisenow",
      "rechnung",
    ])
  })

  it("throws on unknown ids, including the legacy twint", () => {
    expect(() => parsePaymentMethodList("rechnung,bitcoin")).toThrow(/bitcoin/)
    expect(() => parsePaymentMethodList("twint")).toThrow(/twint/)
  })
})

describe("enabledPaymentMethods", () => {
  const config = {
    kiosk: ["rechnung", "monthly"],
    web: ["raisenow", "rechnung", "monthly"],
  } as const

  it("returns the client type's list in configured order", () => {
    expect(enabledPaymentMethods(config, "web", { isMember: true })).toEqual([
      "raisenow",
      "rechnung",
      "monthly",
    ])
    expect(enabledPaymentMethods(config, "kiosk", { isMember: true })).toEqual([
      "rechnung",
      "monthly",
    ])
  })

  it("hides membership-only methods from non-members", () => {
    expect(enabledPaymentMethods(config, "kiosk", { isMember: false })).toEqual([
      "rechnung",
    ])
  })
})

describe("isPaymentMethodEnabledAnywhere", () => {
  it("is true if any client type offers the method", () => {
    const config = { kiosk: ["rechnung"], web: ["rechnung", "raisenow"] } as const
    expect(isPaymentMethodEnabledAnywhere(config, "raisenow")).toBe(true)
    expect(isPaymentMethodEnabledAnywhere(config, "monthly")).toBe(false)
  })
})
