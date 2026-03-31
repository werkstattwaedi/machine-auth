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
  raw: { quantity?: number; lengthCm?: number; widthCm?: number; weightG?: number },
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
