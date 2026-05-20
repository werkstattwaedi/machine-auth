// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Typed catalog seed for E2E + browser tests.
 *
 * The picker reads `variants[0].pricingModel` to choose which entry
 * form to render. If a catalog doc is missing `variants[]` (the v5
 * schema) the picker silently falls back to the ad-hoc DirectForm
 * ("Bezogene Leistungen / Kosten (CHF)"), which breaks every E2E
 * selector that expects the SimpleForm's "Anzahl" / SlaForm's
 * "Resin (ml)" + "Layer" labels.
 *
 * Keeping these fixtures typed against `CatalogItemDoc` means the
 * TypeScript build fails loudly the next time the schema shifts —
 * the seed can never silently regress to the legacy shape again.
 *
 * Note: `AuditFields` (created/modified) is optional on the doc type
 * and Firestore Admin SDK accepts plain objects, so we omit it here.
 */

import type { CatalogItemDoc } from "../../../modules/lib/firestore-entities"

type SeedCatalogDoc = Omit<CatalogItemDoc, "created" | "modified">

export const E2E_CATALOG_DOCS: Record<string, SeedCatalogDoc> = {
  "e2e-item-1": {
    code: "9001",
    name: "E2E Testmaterial",
    workshops: ["holz"],
    category: [],
    variants: [
      {
        id: "default",
        pricingModel: "area",
        unitPrice: { default: 10, member: 8 },
      },
    ],
    active: true,
    userCanAdd: true,
    description: "Testmaterial für E2E Tests",
  },
  "e2e-item-2": {
    code: "9002",
    name: "E2E Holzplatte",
    workshops: ["holz"],
    category: [],
    variants: [
      {
        id: "default",
        pricingModel: "area",
        unitPrice: { default: 5, member: 4 },
      },
    ],
    active: true,
    userCanAdd: true,
  },
  "e2e-item-count": {
    code: "9010",
    name: "Schleifpapier",
    workshops: ["holz"],
    category: [],
    variants: [
      {
        id: "default",
        pricingModel: "count",
        unitPrice: { default: 2, member: 1.5 },
      },
    ],
    active: true,
    userCanAdd: true,
  },
  "e2e-item-3": {
    code: "9003",
    name: "Filament",
    workshops: ["makerspace"],
    category: [],
    variants: [
      {
        id: "default",
        pricingModel: "weight",
        unitPrice: { default: 65, member: 65 },
      },
    ],
    active: true,
    userCanAdd: true,
  },
  "e2e-item-4": {
    code: "9004",
    name: "Filament (Spezial)",
    workshops: ["makerspace"],
    category: [],
    variants: [
      {
        id: "default",
        pricingModel: "weight",
        unitPrice: { default: 105, member: 105 },
      },
    ],
    active: true,
    userCanAdd: true,
  },
  "e2e-item-sla": {
    code: "9099",
    name: "E2E SLA Resin",
    workshops: ["makerspace"],
    category: [],
    variants: [
      {
        id: "default",
        pricingModel: "sla",
        unitPrice: { default: 250, member: 200 },
      },
    ],
    active: true,
    userCanAdd: true,
  },
}
