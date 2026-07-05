// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * SDK-agnostic catalog-import contract: the pure logic that turns the rows
 * of Mario's pricelist xlsx into catalog entries and diffs them against the
 * live catalog. The xlsx → {@link RawImportRow} extraction is environment-
 * specific (SheetJS in `functions/`) and lives there; everything here is
 * pure so the server computes it and the web renders the same types.
 *
 * The row contract is set by the bootstrap (`augment-pricelist-bootstrap.py`):
 * every workshop sheet carries injected `Code`, `Kategorie`, `Unterkategorie`,
 * `Einheit` columns plus Mario's curated `Etikett Name` / `Etikett Mass` (the
 * printed label) and his sale-price column ("Preis Einheit Verkauf"). A row is
 * a product iff it has a Code; heading rows (no Code) are skipped during
 * extraction. The catalog `name` is composed from `Etikett Name` +
 * `Etikett Mass`; those two are also stored verbatim as `labelName`/`labelMass`
 * for the label printer.
 */

import type { PricingModel } from "./pricing"

/** Worksheet tab name → catalog `workshops` key. */
export const SHEET_TO_WORKSHOP: Record<string, string> = {
  Holz: "holz",
  Metall: "metall",
  Keramik: "keramik",
  Textil: "textil",
  Glas: "glas",
  Stein: "stein",
  Schmuck: "schmuck",
}

/** One extracted product row, before validation/normalisation. */
export interface RawImportRow {
  sheet: string
  /** 1-based worksheet row, for error messages. */
  rowNumber: number
  code: string
  /** Curated label text ("Etikett Name") — the source of the display name. */
  labelName: string
  /** Curated label size ("Etikett Mass"), e.g. "24 mm"; may be blank. */
  labelMass: string
  kategorie: string
  unterkategorie?: string | null
  einheit: string
  /** Sale price ("Preis Einheit Verkauf"); null/NaN when blank or a formula error. */
  price: number | null
}

/** A validated, catalog-shaped entry ready for upsert. */
export interface ImportEntry {
  code: string
  /** Display name, composed from `labelName` + `labelMass`. */
  name: string
  /** Curated label fields, stored verbatim for the label printer. */
  labelName: string
  labelMass: string
  workshops: string[]
  category: string[]
  pricingModel: PricingModel
  unitPrice: { default: number }
  active: boolean
  userCanAdd: boolean
}

/** Compose the display name from the curated label pair. */
export function composeName(labelName: string, labelMass: string): string {
  return [labelName.trim(), labelMass.trim()].filter(Boolean).join(" ")
}

export interface ImportIssue {
  sheet: string
  rowNumber: number
  code?: string
  name?: string
  severity: "error" | "warning"
  message: string
  /**
   * Machine-readable tag for issues callers post-process. "no-price" rows
   * are collapsed into the single "open in Excel and save" hint when the
   * whole workbook lacks cached formula results (openpyxl output).
   */
  kind?: "no-price"
}

/**
 * Map the human sale-unit label (Einheit column) to a pricing model.
 * Tolerant of the common spellings Mario / Excel produce. Returns null for
 * an unrecognised unit so the caller can raise an issue instead of guessing.
 */
export function einheitToPricingModel(einheit: string): PricingModel | null {
  const e = einheit.trim().toLowerCase().replace(/\.$/, "")
  switch (e) {
    case "m²":
    case "m2":
    case "qm":
      return "area"
    case "lm":
    case "lfm":
    case "m":
      return "length"
    case "kg":
    case "g":
      return "weight"
    case "stk":
    case "stück":
    case "stueck":
    case "st":
      return "count"
    case "h":
    case "std":
    case "stunde":
      return "time"
    default:
      return null
  }
}

/** Build the root-to-leaf category path, dropping a blank sub-category. */
export function buildCategory(kategorie: string, unterkategorie?: string | null): string[] {
  const path = [kategorie.trim()]
  const sub = (unterkategorie ?? "").trim()
  if (sub) path.push(sub)
  return path
}

/** Round to 2 decimals (catalog prices are CHF, rounded to the Rappen). */
export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export interface NormalizeResult {
  entries: ImportEntry[]
  issues: ImportIssue[]
}

/**
 * Validate + normalise raw rows into catalog entries. Rows with a blocking
 * problem (missing/duplicate code, missing name, non-positive price,
 * unknown unit, unknown sheet) are dropped with an `error` issue; the rest
 * become entries. Duplicate codes within the batch are an error on every
 * offending row (the first occurrence is kept).
 */
export function normalizeRows(rows: RawImportRow[]): NormalizeResult {
  const entries: ImportEntry[] = []
  const issues: ImportIssue[] = []
  const seenCodes = new Map<string, RawImportRow>()

  for (const row of rows) {
    const labelName = row.labelName?.trim() ?? ""
    const labelMass = row.labelMass?.trim() ?? ""
    const base = {
      sheet: row.sheet,
      rowNumber: row.rowNumber,
      code: row.code,
      name: composeName(labelName, labelMass),
    }
    const workshop = SHEET_TO_WORKSHOP[row.sheet]
    if (!workshop) {
      issues.push({ ...base, severity: "error", message: `Unbekanntes Tabellenblatt "${row.sheet}".` })
      continue
    }
    const code = row.code?.trim()
    if (!code) {
      issues.push({ ...base, severity: "error", message: "Code fehlt." })
      continue
    }
    if (seenCodes.has(code)) {
      const first = seenCodes.get(code)!
      issues.push({
        ...base,
        severity: "error",
        message: `Code "${code}" doppelt (zuerst in ${first.sheet} Zeile ${first.rowNumber}).`,
      })
      continue
    }
    if (!labelName) {
      issues.push({ ...base, severity: "error", message: `Etikett Name fehlt (Code ${code}).` })
      continue
    }
    if (row.price == null || !Number.isFinite(row.price) || row.price <= 0) {
      issues.push({
        ...base,
        severity: "error",
        message: `Kein gültiger Verkaufspreis (Code ${code}).`,
        kind: "no-price",
      })
      continue
    }
    const pricingModel = einheitToPricingModel(row.einheit ?? "")
    if (!pricingModel) {
      issues.push({ ...base, severity: "error", message: `Unbekannte Einheit "${row.einheit}" (Code ${code}).` })
      continue
    }
    const kategorie = (row.kategorie ?? "").trim()
    if (!kategorie) {
      issues.push({ ...base, severity: "warning", message: `Keine Kategorie (Code ${code}) — wird unter "Sonstiges" geführt.` })
    }
    seenCodes.set(code, row)
    entries.push({
      code,
      name: composeName(labelName, labelMass),
      labelName,
      labelMass,
      workshops: [workshop],
      category: kategorie ? buildCategory(kategorie, row.unterkategorie) : ["Sonstiges"],
      pricingModel,
      unitPrice: { default: round2(row.price) },
      active: true,
      userCanAdd: true,
    })
  }
  return { entries, issues }
}

// ── Diff against the live catalog ─────────────────────────────────────────────

/** Minimal current-catalog projection the diff needs (built server-side). */
export interface CurrentCatalogItem {
  id: string
  code: string
  name: string
  labelName?: string | null
  labelMass?: string | null
  category: string[]
  workshops: string[]
  active: boolean
  type?: string | null
  pricingModel: string
  unitPrice: number
}

export type DiffKind = "create" | "update" | "unchanged" | "retire"

export interface DiffChange {
  field:
    | "name"
    | "labelName"
    | "labelMass"
    | "price"
    | "category"
    | "pricingModel"
    | "workshops"
    | "active"
  from: unknown
  to: unknown
}

export interface DiffRow {
  kind: DiffKind
  code: string
  name: string
  workshop: string
  /** Firestore doc id for update/retire; undefined for create. */
  id?: string
  /** Desired entry for create/update; undefined for retire. */
  entry?: ImportEntry
  /** Field-level deltas for update. */
  changes?: DiffChange[]
}

export interface ImportSummary {
  create: number
  update: number
  unchanged: number
  retire: number
  errors: number
  warnings: number
}

export interface ImportPreview {
  diff: DiffRow[]
  issues: ImportIssue[]
  summary: ImportSummary
}

/** Ordered equality — for the hierarchical `category` path where order matters. */
function categoriesEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

/** Unordered (set) equality — for `workshops`, where order is not meaningful. */
function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(a)
  return b.every((v) => set.has(v))
}

/**
 * Diff normalised entries against the current catalog, matching on `code`.
 *
 * - create: entry whose code has no current item.
 * - update: code matches but name/price/category/pricingModel/workshops differ
 *   (or the item is inactive and would be reactivated).
 * - unchanged: code matches and everything is identical.
 * - retire: a *material* current item in one of the imported workshops whose
 *   code is absent from the import — set inactive. Machine/NFC items
 *   (`type === "machine"`) are never retired by a material import.
 *
 * Retirement is scoped to the workshops actually present in the import, so a
 * Holz-only file never deactivates Metall items.
 */
export function diffCatalog(entries: ImportEntry[], current: CurrentCatalogItem[]): ImportPreview {
  const byCode = new Map(current.map((c) => [c.code, c]))
  const importedCodes = new Set(entries.map((e) => e.code))
  const importedWorkshops = new Set(entries.flatMap((e) => e.workshops))
  const diff: DiffRow[] = []

  for (const entry of entries) {
    const workshop = entry.workshops[0]
    const cur = byCode.get(entry.code)
    if (!cur) {
      diff.push({ kind: "create", code: entry.code, name: entry.name, workshop, entry })
      continue
    }
    const changes: DiffChange[] = []
    if (cur.name !== entry.name) changes.push({ field: "name", from: cur.name, to: entry.name })
    if ((cur.labelName ?? "") !== entry.labelName)
      changes.push({ field: "labelName", from: cur.labelName ?? "", to: entry.labelName })
    if ((cur.labelMass ?? "") !== entry.labelMass)
      changes.push({ field: "labelMass", from: cur.labelMass ?? "", to: entry.labelMass })
    if (round2(cur.unitPrice) !== entry.unitPrice.default)
      changes.push({ field: "price", from: round2(cur.unitPrice), to: entry.unitPrice.default })
    if (!categoriesEqual(cur.category, entry.category))
      changes.push({ field: "category", from: cur.category, to: entry.category })
    if (cur.pricingModel !== entry.pricingModel)
      changes.push({ field: "pricingModel", from: cur.pricingModel, to: entry.pricingModel })
    if (!sameSet(cur.workshops, entry.workshops))
      changes.push({ field: "workshops", from: cur.workshops, to: entry.workshops })
    if (!cur.active) changes.push({ field: "active", from: false, to: true })
    diff.push({
      kind: changes.length ? "update" : "unchanged",
      code: entry.code,
      name: entry.name,
      workshop,
      id: cur.id,
      entry,
      changes: changes.length ? changes : undefined,
    })
  }

  for (const cur of current) {
    if (cur.type === "machine") continue
    if (!cur.active) continue
    if (!cur.workshops.some((w) => importedWorkshops.has(w))) continue
    if (importedCodes.has(cur.code)) continue
    diff.push({ kind: "retire", code: cur.code, name: cur.name, workshop: cur.workshops[0] ?? "", id: cur.id })
  }

  const summary: ImportSummary = {
    create: diff.filter((d) => d.kind === "create").length,
    update: diff.filter((d) => d.kind === "update").length,
    unchanged: diff.filter((d) => d.kind === "unchanged").length,
    retire: diff.filter((d) => d.kind === "retire").length,
    errors: 0,
    warnings: 0,
  }
  return { diff, issues: [], summary }
}

/** Full preview: normalise rows, then diff, folding issue counts into the summary. */
export function buildImportPreview(rows: RawImportRow[], current: CurrentCatalogItem[]): ImportPreview {
  const { entries, issues } = normalizeRows(rows)
  const preview = diffCatalog(entries, current)
  preview.issues = issues
  preview.summary.errors = issues.filter((i) => i.severity === "error").length
  preview.summary.warnings = issues.filter((i) => i.severity === "warning").length
  return preview
}
