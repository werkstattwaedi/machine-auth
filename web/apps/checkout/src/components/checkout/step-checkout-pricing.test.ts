// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest"
import { computeCheckoutCosts } from "./step-checkout"
import type { PricingConfig } from "@modules/lib/workshop-config"

const config: PricingConfig = {
  entryFees: {
    erwachsen: { regular: 15, materialbezug: 0, intern: 99, hangenmoos: 15 },
    kind: { regular: 7.5, materialbezug: 0, intern: 99, hangenmoos: 7.5 },
    firma: { regular: 30, materialbezug: 0, intern: 99, hangenmoos: 30 },
  },
  workshops: {} as PricingConfig["workshops"],
  slaLayerPrice: { none: 0.01, member: 0.008 },
  labels: {
    units: {},
    discounts: { none: "Normal", member: "Mitglied" },
  },
}

describe("computeCheckoutCosts", () => {
  // Regression for issue #199: when usageType is "intern" the visit is
  // never billed — entry fees, machine, and material costs all collapse
  // to 0 regardless of items / config. This mirrors the server-side
  // `recomputeSummary` defense so the displayed total matches what the
  // server bills. A test that passes without the intern carve-out is
  // not a regression test: removing the early-return in
  // `computeCheckoutCosts` MUST make this case fail.
  it("zeros entry fees, machine and material costs when usageType is intern", () => {
    const result = computeCheckoutCosts({
      persons: [{ userType: "erwachsen" }, { userType: "kind" }],
      usageType: "intern",
      items: [
        { origin: "nfc", totalPrice: 25 },
        { origin: "manual", totalPrice: 12 },
        { origin: "qr", totalPrice: 7 },
      ],
      config,
    })
    expect(result.personFees).toBe(0)
    expect(result.machineCost).toBe(0)
    expect(result.materialCost).toBe(0)
  })

  it("bills entry fees + items normally for non-intern usageType", () => {
    // Sanity check: when usageType is "regular", the same inputs return
    // non-zero costs, confirming the intern branch is the difference.
    const result = computeCheckoutCosts({
      persons: [{ userType: "erwachsen" }],
      usageType: "regular",
      items: [
        { origin: "nfc", totalPrice: 25 },
        { origin: "qr", totalPrice: 12 },
      ],
      config,
    })
    expect(result.personFees).toBe(15)
    expect(result.machineCost).toBe(25)
    expect(result.materialCost).toBe(12)
    expect(result.membershipCost).toBe(0)
  })

  // Issue #262/#263: the Vereinsmitgliedschaft SKU is broken out of
  // materialCost into its own membershipCost bucket so the summary can show
  // it as a dedicated section.
  const MEMBERSHIP_ID = "membership-sku-001"

  it("breaks the membership SKU out into membershipCost (mixed cart)", () => {
    const result = computeCheckoutCosts({
      persons: [{ userType: "erwachsen" }],
      usageType: "regular",
      items: [
        { origin: "nfc", totalPrice: 25 },
        { origin: "manual", totalPrice: 80, catalogId: MEMBERSHIP_ID },
        { origin: "manual", totalPrice: 12, catalogId: "wood-1" },
      ],
      config,
      membershipCatalogId: MEMBERSHIP_ID,
    })
    expect(result.personFees).toBe(15)
    expect(result.machineCost).toBe(25)
    // membership (80) is NOT in materialCost; only the wood item (12) is.
    expect(result.materialCost).toBe(12)
    expect(result.membershipCost).toBe(80)
  })

  it("a membership-only cart yields membershipCost only (materialbezug, fee 0)", () => {
    const result = computeCheckoutCosts({
      persons: [{ userType: "erwachsen" }],
      usageType: "materialbezug",
      items: [
        { origin: "manual", totalPrice: 80, catalogId: MEMBERSHIP_ID },
      ],
      config,
      membershipCatalogId: MEMBERSHIP_ID,
    })
    expect(result.personFees).toBe(0)
    expect(result.machineCost).toBe(0)
    expect(result.materialCost).toBe(0)
    expect(result.membershipCost).toBe(80)
  })

  it("keeps membership in materialCost when no membership SKU is configured", () => {
    // Without a membershipCatalogId nothing is classified as membership —
    // behaviour is identical to before the feature (regression guard).
    const result = computeCheckoutCosts({
      persons: [{ userType: "erwachsen" }],
      usageType: "regular",
      items: [
        { origin: "manual", totalPrice: 80, catalogId: MEMBERSHIP_ID },
        { origin: "manual", totalPrice: 12, catalogId: "wood-1" },
      ],
      config,
      membershipCatalogId: null,
    })
    expect(result.materialCost).toBe(92)
    expect(result.membershipCost).toBe(0)
  })
})
