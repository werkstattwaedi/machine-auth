// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest"
import { LABEL_FORMATS } from "./label-formats"
import { labelVariantOptions, materialLabelInput } from "./material-label-input"

const FORMAT = LABEL_FORMATS["18x72"]
const unitPrice = { default: 1 }
const item = {
  code: "3160",
  name: "MDF 3 mm",
  labelName: "MDF",
  labelMass: "3 mm",
  variants: [
    { id: "default", label: "Per m²", pricingModel: "area" as const, unitPrice },
    { id: "a3", label: "Zuschnitt A3", pricingModel: "count" as const, unitPrice },
  ],
}
const DOMAIN = "checkout.example.ch"
const ITEM_URL = "https://checkout.example.ch/visit/add/item/3160"

describe("materialLabelInput", () => {
  it("links a chosen variant and names it on the label", () => {
    const input = materialLabelInput(DOMAIN, item, FORMAT, "a3")
    expect(input.url).toBe(`${ITEM_URL}/a3`)
    expect(input.variant).toBe("Zuschnitt A3")
  })

  it("keeps the plain item label for the first variant", () => {
    const input = materialLabelInput(DOMAIN, item, FORMAT, "default")
    expect(input.url).toBe(ITEM_URL)
    expect(input.variant).toBeUndefined()
  })

  it("keeps the plain item label without a choice or for a vanished variant", () => {
    expect(materialLabelInput(DOMAIN, item, FORMAT).url).toBe(ITEM_URL)
    expect(materialLabelInput(DOMAIN, item, FORMAT, "gone").url).toBe(ITEM_URL)
  })
})

describe("labelVariantOptions", () => {
  it("names an unlabelled variant the way the checkout does", () => {
    expect(
      labelVariantOptions({
        variants: [{ id: "default", pricingModel: "direct", unitPrice }],
      }),
    ).toEqual([{ value: "default", label: "Standard" }])
  })
})
