// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest"
import {
  PAYMENT_METHODS,
  billDocument,
  enabledPaymentMethods,
  isPaidDuringCheckout,
  isPaymentMethodEnabledAnywhere,
  parsePaymentMethodList,
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

describe("billDocument", () => {
  it("routes Belege to the Beleg mail whatever the method", () => {
    expect(billDocument("beleg", "monthly")).toBe("beleg")
    expect(billDocument("beleg", null)).toBe("beleg")
  })

  it("treats an aggregated invoice as the Sammelrechnung", () => {
    expect(billDocument("invoice", "monthly")).toBe("sammelrechnung")
  })

  it("issues a receipt for methods paid during the checkout, incl. legacy ids", () => {
    expect(billDocument("invoice", "raisenow")).toBe("receipt")
    expect(billDocument(undefined, "twint")).toBe("receipt")
  })

  it("falls back to the payable invoice", () => {
    expect(billDocument("invoice", "rechnung")).toBe("invoice")
    expect(billDocument(undefined, null)).toBe("invoice")
    expect(billDocument("invoice", "bogus")).toBe("invoice")
  })
})
