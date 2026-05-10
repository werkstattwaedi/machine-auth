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
  })
})
