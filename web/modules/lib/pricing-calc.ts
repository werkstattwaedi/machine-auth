// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import type { PricingModel } from "./workshop-config"

export interface PricingResult {
  quantity: number
  totalPrice: number
  formInputs?: { quantity: number; unit: string }[]
}

export function computePricing(
  pricingModel: PricingModel,
  unitPrice: number,
  raw: {
    quantity?: number
    lengthCm?: number
    widthCm?: number
    weightG?: number
    resinMl?: number
    layers?: number
  },
  // SLA has two price axes; resolve to a single DiscountLevel value in the
  // caller and pass it here so this function stays pure.
  slaPricing?: { resinPricePerLiter: number; pricePerLayer: number },
): PricingResult {
  let quantity = 0
  let totalPrice = 0
  let formInputs: { quantity: number; unit: string }[] | undefined

  if (pricingModel === "area") {
    const l = raw.lengthCm ?? 0
    const w = raw.widthCm ?? 0
    quantity = (l / 100) * (w / 100)
    totalPrice = quantity * unitPrice
    formInputs = [
      { quantity: l, unit: "cm" },
      { quantity: w, unit: "cm" },
    ]
  } else if (pricingModel === "length") {
    const l = raw.lengthCm ?? 0
    quantity = l / 100
    totalPrice = quantity * unitPrice
    formInputs = [{ quantity: l, unit: "cm" }]
  } else if (pricingModel === "weight") {
    const g = raw.weightG ?? 0
    quantity = g / 1000
    totalPrice = quantity * unitPrice
    formInputs = [{ quantity: g, unit: "g" }]
  } else if (pricingModel === "direct") {
    const chf = raw.quantity ?? 0
    quantity = 1
    totalPrice = chf
  } else if (pricingModel === "sla") {
    const resinMl = raw.resinMl ?? 0
    const layers = raw.layers ?? 0
    const resinPricePerLiter = slaPricing?.resinPricePerLiter ?? 0
    const pricePerLayer = slaPricing?.pricePerLayer ?? 0
    quantity = 1
    totalPrice =
      (resinMl / 1000) * resinPricePerLiter + layers * pricePerLayer
    formInputs = [
      { quantity: resinMl, unit: "ml" },
      { quantity: layers, unit: "layers" },
    ]
  } else {
    // count, time
    const qty = raw.quantity ?? 0
    quantity = qty
    totalPrice = qty * unitPrice
    formInputs = [{ quantity: qty, unit: pricingModel === "time" ? "h" : "Stk." }]
  }

  totalPrice = Math.round(totalPrice * 100) / 100

  return { quantity, totalPrice, formInputs }
}
