// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useDocument } from "./firestore"

export type WorkshopId =
  | "holz"
  | "metall"
  | "textil"
  | "keramik"
  | "schmuck"
  | "glas"
  | "stein"
  | "malen"
  | "makerspace"
  | "diverses"

export type UnitCategory = "m2" | "m" | "stk" | "chf" | "h" | "kg" | "g" | "l" | "obj"
export type DiscountLevel = "none" | "member" | "intern"
export type ObjectSize = "klein" | "mittel" | "gross"
export type PrintMaterial = "PLA" | "PETG" | "ABS"
export type PricingType = "objectSize" | "3dprint"

export interface MachineConfig {
  id: string
  label: string
  unit: UnitCategory
  prices?: Record<DiscountLevel, number>
  pricingType?: PricingType
  objectSizePrices?: Record<ObjectSize, number>
  materialPrices?: Record<PrintMaterial, number>
}

export interface WorkshopConfig {
  label: string
  order: number
  machines: MachineConfig[]
  materialCategories: UnitCategory[]
  hasServiceItems?: boolean
}

export interface EntryFees {
  erwachsen: Record<string, number>
  kind: Record<string, number>
  firma: Record<string, number>
}

export interface PricingConfig {
  entryFees: EntryFees
  workshops: Record<WorkshopId, WorkshopConfig>
  unitLabels: Record<UnitCategory, string>
  discountLabels: Record<DiscountLevel, string>
  objectSizeLabels: Record<ObjectSize, string>
}

export function usePricingConfig() {
  return useDocument<PricingConfig>("config/pricing")
}

/** Get workshops sorted by order field */
export function getSortedWorkshops(
  config: PricingConfig,
): [WorkshopId, WorkshopConfig][] {
  return (
    Object.entries(config.workshops) as [WorkshopId, WorkshopConfig][]
  ).sort((a, b) => a[1].order - b[1].order)
}
