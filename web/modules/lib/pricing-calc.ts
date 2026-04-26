// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import type { PricingModel } from "./workshop-config"
import {
  cmDimensionsToSquareMeters,
  cmToMeters,
  gramsToKg,
  mlToLiters,
} from "./units"

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
  // SLA has a second price axis (layer cost) that lives in global pricing
  // config rather than on the catalog item. Callers resolve it for the
  // current discount level and pass the number so this function stays pure.
  layerPrice?: number,
): PricingResult {
  let quantity = 0
  let totalPrice = 0
  let formInputs: { quantity: number; unit: string }[] | undefined

  if (pricingModel === "area") {
    const l = raw.lengthCm ?? 0
    const w = raw.widthCm ?? 0
    quantity = cmDimensionsToSquareMeters(l, w)
    totalPrice = quantity * unitPrice
    formInputs = [
      { quantity: l, unit: "cm" },
      { quantity: w, unit: "cm" },
    ]
  } else if (pricingModel === "length") {
    const l = raw.lengthCm ?? 0
    quantity = cmToMeters(l)
    totalPrice = quantity * unitPrice
    formInputs = [{ quantity: l, unit: "cm" }]
  } else if (pricingModel === "weight") {
    const g = raw.weightG ?? 0
    quantity = gramsToKg(g)
    totalPrice = quantity * unitPrice
    formInputs = [{ quantity: g, unit: "g" }]
  } else if (pricingModel === "direct") {
    const chf = raw.quantity ?? 0
    quantity = 1
    totalPrice = chf
  } else if (pricingModel === "sla") {
    const resinMl = raw.resinMl ?? 0
    const layers = raw.layers ?? 0
    const perLayer = layerPrice ?? 0
    quantity = 1
    // unitPrice is CHF per liter of resin; layerPrice is CHF per printed layer.
    totalPrice = mlToLiters(resinMl) * unitPrice + layers * perLayer
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
