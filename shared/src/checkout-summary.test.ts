// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest"
import { computeCheckoutSummary, personEntryFee, rawSections } from "./checkout-summary"

const FEES: Record<string, number> = { erwachsen: 15, kind: 7.5, firma: 30 }
const fee = (ut: string) => FEES[ut]

const persons = [
  { userType: "erwachsen" },
  { userType: "kind", entryFeeWaivedToday: true },
]
const items = [
  { type: "machine", totalPrice: 20 },
  { totalPrice: 10 },
  { type: "material", totalPrice: 0.333 },
]

describe("rawSections", () => {
  it("sums standard fees (skipping waived persons), machine and material by type, and clamps the tip", () => {
    expect(rawSections({ persons, items, standardEntryFee: fee, tip: -3 })).to.deep.equal({
      entryFees: 15,
      machineCost: 20,
      materialCost: 10.333,
      tip: 0,
    })
  })
})

describe("computeCheckoutSummary", () => {
  it("applies the per-section usage discount and rounds to cents", () => {
    const s = computeCheckoutSummary({ persons, usageType: "ermaessigt", items, standardEntryFee: fee, tip: 2.5 })
    expect(s).to.deep.equal({
      totalPrice: 40.33, // 7.5 + 20 + 10.333 + 2.5 → 40.333
      entryFees: 15,
      machineCost: 20,
      materialCost: 10.33,
      tip: 2.5,
      discountAmount: 7.5,
    })
  })

  it("intern waives everything but the tip", () => {
    const s = computeCheckoutSummary({ persons, usageType: "intern", items, standardEntryFee: fee, tip: 4 })
    expect(s.totalPrice).to.equal(4)
    expect(s.discountAmount).to.equal(45.33)
  })

  it("regular bills the raw total", () => {
    const s = computeCheckoutSummary({ persons, usageType: "regular", items, standardEntryFee: fee, tip: 0 })
    expect(s.totalPrice).to.equal(45.33)
    expect(s.discountAmount).to.equal(0)
  })
})

// Issue #605: each person's own usage type discounts their usage fee; the
// visit's type keeps deciding machines and material.
describe("per-person usage types (issue #605)", () => {
  const adultAccompanies = { userType: "erwachsen", usageType: "materialbezug" as const }
  const childWorks = { userType: "kind", usageType: "regular" as const }

  it("an adult on Begleitung with a working child pays the child's fee", () => {
    const s = computeCheckoutSummary({
      persons: [adultAccompanies, childWorks],
      usageType: "regular",
      items: [{ type: "machine", totalPrice: 20 }],
      standardEntryFee: fee,
      tip: 0,
    })
    expect(s.entryFees).to.equal(22.5) // raw: both standard fees
    expect(s.totalPrice).to.equal(27.5) // 7.50 + machine 20
    expect(s.discountAmount).to.equal(15)
  })

  it("falls back to the visit type for persons without their own", () => {
    expect(personEntryFee({ userType: "erwachsen" }, "ermaessigt", fee)).to.equal(7.5)
    expect(
      personEntryFee({ userType: "erwachsen", usageType: "regular" }, "intern", fee),
    ).to.equal(15)
    expect(
      personEntryFee({ userType: "kind", entryFeeWaivedToday: true }, "regular", fee),
    ).to.equal(0)
  })
})
