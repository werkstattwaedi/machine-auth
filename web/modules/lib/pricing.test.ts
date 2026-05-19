// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest"
import {
  calculateFee,
  catalogPriceForTier,
  primaryVariant,
  type UserType,
  type UsageType,
} from "./pricing"
import type { CatalogItemDoc } from "./firestore-entities"
import type { PricingConfig } from "./workshop-config"

describe("calculateFee", () => {
  describe("with config", () => {
    const config: PricingConfig = {
      entryFees: {
        erwachsen: { regular: 20, ermaessigt: 10, materialbezug: 5, intern: 0, hangenmoos: 25 },
        kind: { regular: 10, ermaessigt: 5, materialbezug: 0, intern: 0, hangenmoos: 10 },
        firma: { regular: 50, ermaessigt: 25, materialbezug: 10, intern: 0, hangenmoos: 50 },
      },
      slaLayerPrice: { none: 0.01, member: 0.008 },
      workshops: {} as PricingConfig["workshops"],
      labels: {} as PricingConfig["labels"],
    }

    it.each([
      ["erwachsen", "regular", 20],
      ["erwachsen", "ermaessigt", 10],
      ["erwachsen", "materialbezug", 5],
      ["kind", "regular", 10],
      ["kind", "ermaessigt", 5],
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

// Issue #285: the e2e seed historically wrote catalog docs in the legacy
// shape (`pricingModel` + `unitPrice` at the top level). The v5 picker
// reads `variants[0]` instead, so a legacy-shaped doc renders the wrong
// form (always "direct"), the label-based test locators never resolve,
// and the whole anonymous-checkout + screenshot suite goes red.
//
// These tests pin the contract the seed (and any catalog ingest path)
// has to honour: `variants[]` is the source of truth; legacy docs that
// look superficially complete must still resolve to 0 here so callers
// can fall back / surface the issue instead of silently mis-pricing.
describe("primaryVariant / catalogPriceForTier — v5 variants[] contract (#285)", () => {
  const v5Doc = {
    variants: [
      { id: "default", pricingModel: "count", unitPrice: { default: 2, member: 1.5 } },
    ],
  } as unknown as CatalogItemDoc

  it("returns the canonical variant from variants[0]", () => {
    const v = primaryVariant(v5Doc)
    expect(v?.id).toBe("default")
    expect(v?.pricingModel).toBe("count")
  })

  it("resolves the default price for tier 'none'", () => {
    expect(catalogPriceForTier(v5Doc, "none")).toBe(2)
  })

  it("resolves the member price for tier 'member'", () => {
    expect(catalogPriceForTier(v5Doc, "member")).toBe(1.5)
  })

  it("returns 0 when variants is missing (legacy seed, #285 root cause)", () => {
    // Reproduces the failure mode that broke the e2e baseline: a catalog
    // doc with the legacy top-level pricingModel / unitPrice and no
    // variants[] resolves to 0 here. The picker's headerUnitPrice
    // depends on this so the row at least renders (price visible as
    // "CHF 0.00") instead of crashing — the actual bug is that the
    // expand-form falls back to "direct" and the test locators time
    // out. The fix is at the seed layer, not here.
    const legacyDoc = {
      // No variants[] — only legacy fields.
      pricingModel: "count",
      unitPrice: { none: 2, member: 1.5 },
    } as unknown as CatalogItemDoc
    expect(primaryVariant(legacyDoc)).toBeUndefined()
    expect(catalogPriceForTier(legacyDoc, "none")).toBe(0)
    expect(catalogPriceForTier(legacyDoc, "member")).toBe(0)
  })

  it("returns 0 when variants is an empty array", () => {
    const emptyDoc = { variants: [] } as unknown as CatalogItemDoc
    expect(primaryVariant(emptyDoc)).toBeUndefined()
    expect(catalogPriceForTier(emptyDoc, "none")).toBe(0)
  })
})
