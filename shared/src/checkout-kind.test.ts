// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest"
import { classifyBillKind, classifyCheckoutKind } from "./checkout-kind"

const membershipCatalogId = "membership-sku"
const membership = { catalogId: "membership-sku" }
const badge = { catalogId: "badge-sku" }
const material = { catalogId: "wood", type: "material" }
const machine = { catalogId: "laser", type: "machine" }

describe("classifyCheckoutKind", () => {
  const cases: [string, string, object[], string | null, string][] = [
    ["regular visit with entry fee only", "regular", [], membershipCatalogId, "visit"],
    ["intern visit without items", "intern", [], membershipCatalogId, "visit"],
    ["regular visit with a membership", "regular", [membership], membershipCatalogId, "visit"],
    ["materialbezug with a machine item", "materialbezug", [machine], membershipCatalogId, "visit"],
    ["membership only", "materialbezug", [membership], membershipCatalogId, "membership"],
    ["badge only", "materialbezug", [badge], membershipCatalogId, "purchase"],
    ["badge + membership", "materialbezug", [badge, membership], membershipCatalogId, "purchase"],
    ["material only", "materialbezug", [material], membershipCatalogId, "purchase"],
    ["no items", "materialbezug", [], membershipCatalogId, "purchase"],
    ["membership SKU not configured", "materialbezug", [membership], null, "purchase"],
  ]
  for (const [name, usageType, items, catalogId, kind] of cases) {
    it(name, () => {
      expect(
        classifyCheckoutKind({ usageType, items, membershipCatalogId: catalogId }),
      ).toBe(kind)
    })
  }
})

describe("classifyBillKind", () => {
  it("a visit wins", () => {
    expect(classifyBillKind(["membership", "visit", "purchase"])).toBe("visit")
  })
  it("all-membership stays membership", () => {
    expect(classifyBillKind(["membership", "membership"])).toBe("membership")
  })
  it("any other mix is a purchase", () => {
    expect(classifyBillKind(["membership", "purchase"])).toBe("purchase")
    expect(classifyBillKind([])).toBe("purchase")
  })
})
