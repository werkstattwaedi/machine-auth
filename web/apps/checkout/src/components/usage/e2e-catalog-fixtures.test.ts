// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Regression test for issue #292.
 *
 * The E2E specs reach into the picker for inputs like
 *   `label:has-text("Anzahl")` (SimpleForm — count/weight/time),
 *   `label:has-text("Resin (ml)")` + `label:has-text("Layer")` (SlaForm),
 *   `label:has-text("Länge (cm)")` (LengthForm / AreaForm).
 *
 * Those labels only render when the catalog item carries a valid v5
 * variant — the picker reads `variants[0].pricingModel` and falls back
 * to the ad-hoc DirectForm when variants are missing. The legacy seed
 * shape (`pricingModel` + `unitPrice` on the doc root) drops every
 * catalog row into DirectForm, which is why all picker-driven E2E
 * tests started timing out after the v5 picker landed.
 *
 * Lock the seed shape in here so any future drift fails fast in the
 * vitest tier, before the slow e2e suite even starts.
 */

import { describe, expect, it } from "vitest"
import { E2E_CATALOG_DOCS } from "../../../e2e/catalog-fixtures"
import type { PricingModel } from "@modules/lib/firestore-entities"

const VALID_MODELS: PricingModel[] = [
  "time",
  "area",
  "length",
  "count",
  "weight",
  "direct",
  "sla",
]

describe("E2E catalog seed shape", () => {
  const entries = Object.entries(E2E_CATALOG_DOCS)

  it("seeds at least one item per pricing model the e2e specs exercise", () => {
    // The picker chooses entry form by `variants[0].pricingModel`; the
    // e2e suite covers area / count / weight / sla — each must remain
    // represented or the corresponding spec stops exercising the form.
    const models = new Set(
      entries.map(([, doc]) => doc.variants[0]?.pricingModel),
    )
    expect(models.has("area")).toBe(true)
    expect(models.has("count")).toBe(true)
    expect(models.has("weight")).toBe(true)
    expect(models.has("sla")).toBe(true)
  })

  for (const [id, doc] of entries) {
    describe(id, () => {
      it("has a non-empty variants array", () => {
        expect(Array.isArray(doc.variants)).toBe(true)
        expect(doc.variants.length).toBeGreaterThan(0)
      })

      it("uses a valid pricingModel on variants[0]", () => {
        const pm = doc.variants[0]?.pricingModel
        expect(VALID_MODELS).toContain(pm)
        // The legacy shape lacked variants entirely; the picker would
        // then default to "direct", masking the real failure as a 30s
        // selector timeout. Refuse "direct" here unless the fixture
        // explicitly intends an ad-hoc item — none of our seeded items
        // do, so this guard catches accidental regressions.
        expect(pm).not.toBe("direct")
      })

      it("has VariantPrice.default set (not the legacy { none, member } shape)", () => {
        const price = doc.variants[0]?.unitPrice
        expect(price).toBeDefined()
        expect(typeof price?.default).toBe("number")
        // The legacy seed used `unitPrice: { none, member }` on the doc
        // root. Calling that object out via type cast so the assertion
        // is meaningful even when the test source compiles cleanly.
        expect("none" in (price as object)).toBe(false)
      })

      it("carries a category array (queryable even when empty)", () => {
        expect(Array.isArray(doc.category)).toBe(true)
      })
    })
  }
})
