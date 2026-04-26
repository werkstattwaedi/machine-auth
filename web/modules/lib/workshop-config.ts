// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useDocument, useCollection } from "./firestore"
import { catalogCollection, configRef } from "./firestore-helpers"
import { useDb } from "./firebase-context"
import { where } from "firebase/firestore"
import type {
  CatalogItemDoc,
  PriceListDoc,
  PricingConfigDoc,
  PricingLabels,
  PricingModel,
  DiscountLevel,
  WorkshopConfigEntry,
  PricingEntryFees,
} from "./firestore-entities"

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

export type { DiscountLevel, PricingModel, PricingLabels }

/** Display config for a single workshop. */
export type WorkshopConfig = WorkshopConfigEntry

export type EntryFees = PricingEntryFees

/** Backward-compat alias. New code should import `PricingConfigDoc`. */
export type PricingConfig = PricingConfigDoc

/** Backward-compat alias of the catalog wire format with the synthetic id. */
export type CatalogItem = CatalogItemDoc & { id: string }

/** Backward-compat alias of the price-list wire format with the synthetic id. */
export type PriceList = PriceListDoc & { id: string }

export function usePricingConfig() {
  const db = useDb()
  // The "config" collection is open-ended (one doc per concern); for the
  // pricing doc we narrow the generic explicitly.
  return useDocument<PricingConfigDoc>(
    configRef(db, "pricing") as unknown as import("firebase/firestore").DocumentReference<PricingConfigDoc>,
  )
}

/** Get workshops sorted by order field */
export function getSortedWorkshops(
  config: PricingConfigDoc,
): [WorkshopId, WorkshopConfigEntry][] {
  return (
    Object.entries(config.workshops) as [WorkshopId, WorkshopConfigEntry][]
  ).sort((a, b) => a[1].order - b[1].order)
}

/** Get user-addable catalog items for a workshop */
export function useCatalogForWorkshop(workshopId: string | null) {
  const db = useDb()
  return useCollection(
    workshopId ? catalogCollection(db) : null,
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
export function getUnitLabel(config: PricingConfigDoc, pricingModel: PricingModel): string {
  const map: Record<PricingModel, string> = {
    time: config.labels?.units?.h ?? "Std.",
    area: config.labels?.units?.m2 ?? "m²",
    length: config.labels?.units?.m ?? "m",
    count: config.labels?.units?.stk ?? "Stk.",
    weight: config.labels?.units?.kg ?? "kg",
    direct: config.labels?.units?.chf ?? (import.meta.env.VITE_CURRENCY || "CHF"),
    // SLA resin is priced per liter of resin consumed (plus a constant
    // per-layer cost from pricingConfig.slaLayerPrice). `unitPrice` on an
    // SLA catalog entry is therefore CHF/l.
    sla: config.labels?.units?.l ?? "l",
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
    case "sla": return "l"
    default: return ""
  }
}

/**
 * SI base unit used to *store* quantities in Firestore for each pricing
 * model. Returns `null` for non-SI dimensions (count, direct CHF) where a
 * smart-rescaling formatter doesn't apply. The mapping is the single source
 * of truth for the storage convention — see `units.ts` for the full
 * documentation.
 */
export function getStorageBaseUnit(
  pm: PricingModel,
): "m" | "m2" | "l" | "kg" | "h" | null {
  switch (pm) {
    case "time": return "h"
    case "area": return "m2"
    case "length": return "m"
    case "weight": return "kg"
    case "sla": return "l"
    case "count":
    case "direct":
    default: return null
  }
}
