// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useDocument, useCollection } from "./firestore"
import { catalogCollection, configRef } from "./firestore-helpers"
import { useDb } from "./firebase-context"
import { where } from "firebase/firestore"
import { currency } from "./format"
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

/**
 * Runtime validator for the `config/pricing` Firestore document.
 *
 * Returns `null` on a valid shape, or a human-readable reason describing
 * the first missing/wrong-typed field. Per issue #149 the checkout UI must
 * refuse to render if this returns non-null, surfacing a clear error to
 * staff rather than silently using a hardcoded fallback that may diverge
 * from the real prices.
 *
 * Hand-rolled rather than depending on zod to avoid a new web runtime
 * dependency for a single ~30-line check; the shape is small and stable.
 */
export function validatePricingConfig(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return "config/pricing document is missing or not an object"
  }
  const cfg = value as Record<string, unknown>

  const entryFees = cfg.entryFees as Record<string, unknown> | undefined
  if (!entryFees || typeof entryFees !== "object") {
    return "config/pricing.entryFees is missing"
  }
  for (const userType of ["erwachsen", "kind", "firma"] as const) {
    const row = entryFees[userType] as Record<string, unknown> | undefined
    if (!row || typeof row !== "object") {
      return `config/pricing.entryFees.${userType} is missing`
    }
    for (const usage of ["regular", "materialbezug", "intern", "hangenmoos"] as const) {
      if (typeof row[usage] !== "number") {
        return `config/pricing.entryFees.${userType}.${usage} must be a number`
      }
    }
  }

  if (!cfg.workshops || typeof cfg.workshops !== "object") {
    return "config/pricing.workshops is missing"
  }

  if (!cfg.labels || typeof cfg.labels !== "object") {
    return "config/pricing.labels is missing"
  }

  const slaLayerPrice = cfg.slaLayerPrice as Record<string, unknown> | undefined
  if (!slaLayerPrice || typeof slaLayerPrice !== "object") {
    return "config/pricing.slaLayerPrice is missing"
  }
  for (const level of ["none", "member", "intern"] as const) {
    if (typeof slaLayerPrice[level] !== "number") {
      return `config/pricing.slaLayerPrice.${level} must be a number`
    }
  }

  return null
}

/**
 * Subscribe to `config/pricing`.
 *
 * Returns the standard `{ data, loading, error }` shape plus a derived
 * `configError` string set when the document is missing or fails the
 * `validatePricingConfig` shape check. Callers must refuse to render the
 * checkout when `configError` is non-null (issue #149) — silently
 * substituting a hardcoded fallback was the bug A8 was filed for.
 */
export function usePricingConfig() {
  const db = useDb()
  // The "config" collection is open-ended (one doc per concern); for the
  // pricing doc we narrow the generic explicitly.
  const result = useDocument<PricingConfigDoc>(
    configRef(db, "pricing") as unknown as import("firebase/firestore").DocumentReference<PricingConfigDoc>,
  )
  let configError: string | null = null
  if (!result.loading && !result.error) {
    if (result.data == null) {
      configError = "config/pricing document is missing"
    } else {
      configError = validatePricingConfig(result.data)
    }
  }
  return { ...result, configError }
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

/**
 * Get unit display label.
 *
 * The `?? "<german>"` fallbacks below are deliberate safe defaults: each
 * is purely cosmetic and used only when `config/pricing.labels.units` is
 * partially populated. The labels are localized German strings, so the
 * issue #149 fail-loud rule does not apply (carve-out: "If a default is
 * genuinely safe (e.g., locale string), explicitly comment why.").
 */
export function getUnitLabel(config: PricingConfigDoc, pricingModel: PricingModel): string {
  const map: Record<PricingModel, string> = {
    time: config.labels?.units?.h ?? "Std.",
    area: config.labels?.units?.m2 ?? "m²",
    length: config.labels?.units?.m ?? "m",
    count: config.labels?.units?.stk ?? "Stk.",
    weight: config.labels?.units?.kg ?? "kg",
    // Currency comes from the validated `currency` constant in format.ts —
    // single source of truth, no silent "CHF" fallback at this layer.
    direct: config.labels?.units?.chf ?? currency,
    // SLA resin is priced per liter of resin consumed (plus a constant
    // per-layer cost from pricingConfig.slaLayerPrice). `unitPrice` on an
    // SLA catalog entry is therefore CHF/l.
    sla: config.labels?.units?.l ?? "l",
  }
  return map[pricingModel] ?? pricingModel
}

/**
 * Short unit label (no config needed).
 *
 * The unit symbols below are universal SI / typographical conventions that
 * intentionally don't depend on `config/pricing.labels.units` — these are
 * the catalogue-display defaults used when no config is loaded yet (e.g.
 * the standalone material catalogue route). For the currency case we
 * defer to the validated `currency` constant in format.ts so there is one
 * source of truth that fails loud if VITE_CURRENCY is unset.
 */
export function getShortUnit(pm: PricingModel): string {
  switch (pm) {
    case "time": return "h"
    case "area": return "m²"
    case "length": return "m"
    case "count": return "Stk."
    case "weight": return "kg"
    case "direct": return currency
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
