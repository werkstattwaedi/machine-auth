// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest"
import { computeCheckoutCosts } from "./step-checkout"
import type { PricingConfig } from "@modules/lib/workshop-config"

// Issue #284: one standard fee per user type; the usage-type discount
// (USAGE_TYPE_DISCOUNTS in @oww/shared) derives the rest.
const config: PricingConfig = {
  entryFees: {
    erwachsen: { regular: 15 },
    kind: { regular: 7.5 },
    firma: { regular: 30 },
  },
  workshops: {} as PricingConfig["workshops"],
  slaLayerPrice: { none: 0.01, member: 0.008 },
  labels: {
    units: {},
    discounts: { none: "Normal", member: "Mitglied" },
  },
}

describe("computeCheckoutCosts", () => {
  // Regression for issue #284: `computeCheckoutCosts` now returns BOTH raw
  // (standard) and net (post-discount) section amounts. The displayed
  // total mirrors the server-side `recomputeSummary` net.
  it("stores raw amounts and waives everything but tip for intern (net = 0)", () => {
    const result = computeCheckoutCosts({
      persons: [{ userType: "erwachsen" }, { userType: "kind" }],
      usageType: "intern",
      items: [
        { origin: "nfc", type: "machine", totalPrice: 25 },
        { origin: "manual", totalPrice: 12 },
        { origin: "qr", totalPrice: 7 },
      ],
      config,
    })
    // RAW (standard) amounts preserved.
    expect(result.personFees).toBe(22.5) // 15 + 7.5
    expect(result.machineCost).toBe(25)
    expect(result.materialCost).toBe(19) // 12 + 7
    // NET: intern waives entry + machine + material.
    expect(result.personFeesNet).toBe(0)
    expect(result.machineCostNet).toBe(0)
    expect(result.materialCostNet).toBe(0)
  })

  // Regression for issue #284: volunteering (Freiwilligengruppe) waives
  // entry + machine but bills material.
  it("waives entry + machine but bills material for volunteering", () => {
    const result = computeCheckoutCosts({
      persons: [{ userType: "erwachsen" }],
      usageType: "volunteering",
      items: [
        { origin: "nfc", type: "machine", totalPrice: 25 },
        { origin: "qr", totalPrice: 12 },
      ],
      config,
    })
    expect(result.personFees).toBe(15)
    expect(result.machineCost).toBe(25)
    expect(result.materialCost).toBe(12)
    // NET: only material is billed.
    expect(result.personFeesNet).toBe(0)
    expect(result.machineCostNet).toBe(0)
    expect(result.materialCostNet).toBe(12)
  })

  it("halves the entry fee for ermaessigt", () => {
    const result = computeCheckoutCosts({
      persons: [{ userType: "erwachsen" }],
      usageType: "ermaessigt",
      items: [{ origin: "nfc", type: "machine", totalPrice: 20 }],
      config,
    })
    expect(result.personFees).toBe(15)
    expect(result.personFeesNet).toBe(7.5)
    expect(result.machineCostNet).toBe(20)
  })

  it("bills entry fees + items in full for regular usageType", () => {
    const result = computeCheckoutCosts({
      persons: [{ userType: "erwachsen" }],
      usageType: "regular",
      items: [
        { origin: "nfc", type: "machine", totalPrice: 25 },
        { origin: "qr", totalPrice: 12 },
      ],
      config,
    })
    expect(result.personFees).toBe(15)
    expect(result.machineCost).toBe(25)
    expect(result.materialCost).toBe(12)
    expect(result.membershipCost).toBe(0)
    expect(result.personFeesNet).toBe(15)
    expect(result.machineCostNet).toBe(25)
    expect(result.materialCostNet).toBe(12)
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
        { origin: "nfc", type: "machine", totalPrice: 25 },
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
    // RAW entry fee is the standard fee (issue #284); materialbezug waives it
    // via the discount multiplier, so the NET (billed) entry fee is 0.
    expect(result.personFees).toBe(15)
    expect(result.personFeesNet).toBe(0)
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
