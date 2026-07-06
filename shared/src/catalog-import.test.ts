// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest"
import {
  einheitToPricingModel,
  buildCategory,
  composeName,
  normalizeRows,
  diffCatalog,
  buildImportPreview,
  type RawImportRow,
  type CurrentCatalogItem,
} from "./catalog-import"

function row(over: Partial<RawImportRow> = {}): RawImportRow {
  return {
    sheet: "Holz",
    rowNumber: 10,
    code: "3001",
    labelName: "Ahorn",
    labelMass: "24 mm",
    kategorie: "Massivholz",
    unterkategorie: "Ahorn",
    einheit: "m²",
    price: 57.6,
    ...over,
  }
}

describe("einheitToPricingModel", () => {
  it("maps the canonical units", () => {
    expect(einheitToPricingModel("m²")).toBe("area")
    expect(einheitToPricingModel("m2")).toBe("area")
    expect(einheitToPricingModel("lm")).toBe("length")
    expect(einheitToPricingModel("kg")).toBe("weight")
    expect(einheitToPricingModel("Stk")).toBe("count")
  })
  it("is tolerant of case / whitespace / trailing dot", () => {
    expect(einheitToPricingModel("  STK. ")).toBe("count")
    expect(einheitToPricingModel("Stück")).toBe("count")
  })
  it("returns null for an unknown unit", () => {
    expect(einheitToPricingModel("Bund")).toBeNull()
  })
})

describe("buildCategory", () => {
  it("drops a blank sub-category", () => {
    expect(buildCategory("Tone", "")).toEqual(["Tone"])
    expect(buildCategory("Tone", null)).toEqual(["Tone"])
    expect(buildCategory("Massivholz", "Ahorn")).toEqual(["Massivholz", "Ahorn"])
  })
})

describe("composeName", () => {
  it("joins the curated label pair, dropping a blank mass", () => {
    expect(composeName("Ahorn", "24 mm")).toBe("Ahorn 24 mm")
    expect(composeName("B128", "")).toBe("B128")
    expect(composeName(" Flachstahl ", " 15 × 2 mm ")).toBe("Flachstahl 15 × 2 mm")
  })
})

describe("normalizeRows", () => {
  it("builds a catalog entry from a good row, composing the name", () => {
    const { entries, issues } = normalizeRows([row()])
    expect(issues).toHaveLength(0)
    expect(entries[0]).toEqual({
      code: "3001",
      name: "Ahorn 24 mm",
      labelName: "Ahorn",
      labelMass: "24 mm",
      workshops: ["holz"],
      category: ["Massivholz", "Ahorn"],
      pricingModel: "area",
      unitPrice: { default: 57.6 },
      active: true,
      userCanAdd: true,
    })
  })

  it("maps each sheet to its workshop", () => {
    const rows = [
      row({ sheet: "Metall", code: "2001", einheit: "lm" }),
      row({ sheet: "Keramik", code: "4216", einheit: "kg" }),
      row({ sheet: "Textil", code: "7001", einheit: "Stk" }),
      row({ sheet: "Glas", code: "5503", einheit: "Stk" }),
    ]
    const { entries } = normalizeRows(rows)
    expect(entries.map((e) => e.workshops[0])).toEqual(["metall", "keramik", "textil", "glas"])
  })

  it("errors on missing code, label name, bad price, unknown unit, unknown sheet", () => {
    const { entries, issues } = normalizeRows([
      row({ code: "" }),
      row({ code: "3002", labelName: "  " }),
      row({ code: "3003", price: 0 }),
      row({ code: "3004", price: null }),
      row({ code: "3005", einheit: "Bund" }),
      row({ code: "3006", sheet: "Unsinn" }),
    ])
    expect(entries).toHaveLength(0)
    expect(issues.every((i) => i.severity === "error")).toBe(true)
    expect(issues).toHaveLength(6)
  })

  it("flags duplicate codes, keeping the first occurrence", () => {
    const { entries, issues } = normalizeRows([
      row({ code: "3001", rowNumber: 10 }),
      row({ code: "3001", rowNumber: 20, labelName: "Dup" }),
    ])
    expect(entries).toHaveLength(1)
    expect(entries[0].name).toBe("Ahorn 24 mm")
    expect(issues).toHaveLength(1)
    expect(issues[0].message).toContain("doppelt")
  })

  it("warns (not errors) on a missing category and falls back to Sonstiges", () => {
    const { entries, issues } = normalizeRows([row({ kategorie: "" })])
    expect(entries).toHaveLength(1)
    expect(entries[0].category).toEqual(["Sonstiges"])
    expect(issues[0].severity).toBe("warning")
  })
})

describe("diffCatalog", () => {
  function current(over: Partial<CurrentCatalogItem> = {}): CurrentCatalogItem {
    return {
      id: "doc-3001",
      code: "3001",
      name: "Ahorn 24 mm",
      labelName: "Ahorn",
      labelMass: "24 mm",
      category: ["Massivholz", "Ahorn"],
      workshops: ["holz"],
      active: true,
      pricingModel: "area",
      unitPrice: 57.6,
      ...over,
    }
  }

  it("create when code is new", () => {
    const { entries } = normalizeRows([row({ code: "3999" })])
    const preview = diffCatalog(entries, [current()])
    const created = preview.diff.find((d) => d.code === "3999")
    expect(created?.kind).toBe("create")
    expect(created?.id).toBeUndefined()
  })

  it("unchanged when everything matches", () => {
    const { entries } = normalizeRows([row()])
    const preview = diffCatalog(entries, [current()])
    expect(preview.diff[0].kind).toBe("unchanged")
    expect(preview.summary.unchanged).toBe(1)
  })

  it("update with field deltas when the price changes", () => {
    const { entries } = normalizeRows([row({ price: 60 })])
    const preview = diffCatalog(entries, [current()])
    const upd = preview.diff[0]
    expect(upd.kind).toBe("update")
    expect(upd.id).toBe("doc-3001")
    expect(upd.changes).toContainEqual({ field: "price", from: 57.6, to: 60 })
  })

  it("tracks label field changes on update (curated relabel)", () => {
    const { entries } = normalizeRows([row({ labelMass: "30 mm" })])
    const preview = diffCatalog(entries, [current()])
    const upd = preview.diff[0]
    expect(upd.kind).toBe("update")
    expect(upd.changes).toContainEqual({ field: "labelMass", from: "24 mm", to: "30 mm" })
    expect(upd.changes).toContainEqual({ field: "name", from: "Ahorn 24 mm", to: "Ahorn 30 mm" })
  })

  it("treats a current item without stored labels as a label change", () => {
    const { entries } = normalizeRows([row()])
    const preview = diffCatalog(entries, [current({ labelName: null, labelMass: null })])
    const upd = preview.diff[0]
    expect(upd.kind).toBe("update")
    expect(upd.changes).toContainEqual({ field: "labelName", from: "", to: "Ahorn" })
  })

  it("reactivates an inactive matched item", () => {
    const { entries } = normalizeRows([row()])
    const preview = diffCatalog(entries, [current({ active: false })])
    expect(preview.diff[0].kind).toBe("update")
    expect(preview.diff[0].changes).toContainEqual({ field: "active", from: false, to: true })
  })

  it("retires an active material in an imported workshop that is absent from the import", () => {
    const { entries } = normalizeRows([row({ code: "3001" })])
    const preview = diffCatalog(entries, [current(), current({ id: "doc-3050", code: "3050", name: "Eiche 24 mm" })])
    const retired = preview.diff.find((d) => d.code === "3050")
    expect(retired?.kind).toBe("retire")
    expect(retired?.id).toBe("doc-3050")
  })

  it("never retires a machine item, nor items in workshops absent from the import", () => {
    const { entries } = normalizeRows([row({ code: "3001" })]) // holz only
    const preview = diffCatalog(entries, [
      current(),
      current({ id: "m1", code: "1001", name: "Fräse", type: "machine" }),
      current({ id: "k1", code: "4204", name: "Ton", workshops: ["keramik"] }),
    ])
    expect(preview.diff.some((d) => d.kind === "retire")).toBe(false)
  })
})

describe("buildImportPreview", () => {
  it("folds issue counts into the summary", () => {
    const preview = buildImportPreview([row({ code: "" }), row({ code: "3001", kategorie: "" })], [])
    expect(preview.summary.errors).toBe(1)
    expect(preview.summary.warnings).toBe(1)
    expect(preview.summary.create).toBe(1) // the warning row still imports
  })
})
