// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useDocument, useCollection } from "./firestore"
import { where } from "firebase/firestore"

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

export type DiscountLevel = "none" | "member" | "intern"
export type PricingModel =
  | "time"
  | "area"
  | "length"
  | "count"
  | "weight"
  | "direct"
  | "sla"

export interface WorkshopConfig {
  label: string
  order: number
}

export interface EntryFees {
  erwachsen: Record<string, number>
  kind: Record<string, number>
  firma: Record<string, number>
}

export interface PricingLabels {
  units: Record<string, string>
  discounts: Record<DiscountLevel, string>
}

export interface PricingConfig {
  entryFees: EntryFees
  workshops: Record<WorkshopId, WorkshopConfig>
  labels: PricingLabels
  // SLA resin prints have a per-layer cost that's constant across all resin
  // types (driven by hardware wear, not material). Configured globally so a
  // new resin catalog entry doesn't need its own copy of these numbers.
  slaLayerPrice: Record<DiscountLevel, number>
}

export interface CatalogItem {
  id: string
  code: string
  name: string
  workshops: string[]
  pricingModel: PricingModel
  // For `pricingModel === "sla"` this is CHF per liter of resin; the per-layer
  // portion of the cost comes from `PricingConfig.slaLayerPrice`.
  unitPrice: Record<DiscountLevel, number>
  active: boolean
  userCanAdd: boolean
  description?: string | null
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

export interface PriceList {
  id: string
  name: string
  items: string[] // catalog document IDs (not DocumentReferences — needed for documentId() queries)
  footer: string
  active: boolean
}

/** Get user-addable catalog items for a workshop */
export function useCatalogForWorkshop(workshopId: string | null) {
  return useCollection<CatalogItem>(
    workshopId ? "catalog" : null,
    ...(workshopId
      ? [
          where("active", "==", true),
          where("userCanAdd", "==", true),
          where("workshops", "array-contains", workshopId),
        ]
      : []),
  )
}

/** Get unit display label */
export function getUnitLabel(config: PricingConfig, pricingModel: PricingModel): string {
  const map: Record<PricingModel, string> = {
    time: config.labels?.units?.h ?? "Std.",
    area: config.labels?.units?.m2 ?? "m²",
    length: config.labels?.units?.m ?? "m",
    count: config.labels?.units?.stk ?? "Stk.",
    weight: config.labels?.units?.kg ?? "kg",
    direct: config.labels?.units?.chf ?? (import.meta.env.VITE_CURRENCY || "CHF"),
    // SLA resin is priced per liter of resin consumed (plus a constant
    // per-layer cost from pricingConfig.slaLayerPrice). `unitPrice` on an
    // SLA catalog entry is therefore CHF/L.
    sla: config.labels?.units?.l ?? "L",
  }
  return map[pricingModel] ?? pricingModel
}

/** Short unit label (no config needed) */
export function getShortUnit(pm: PricingModel): string {
  switch (pm) {
    case "time": return "h"
    case "area": return "m²"
    case "length": return "m"
    case "count": return "Stk."
    case "weight": return "kg"
    case "direct": return import.meta.env.VITE_CURRENCY || "CHF"
    case "sla": return "L"
    default: return ""
  }
}
