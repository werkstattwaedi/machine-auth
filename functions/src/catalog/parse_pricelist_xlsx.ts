// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Extract {@link RawImportRow}s from Mario's pricelist workbook.
 *
 * This is the only environment-specific part of the import pipeline — it
 * reads the xlsx (ExcelJS, which surfaces the *cached* result of Mario's
 * price formulas) and hands clean rows to the pure `@oww/shared` logic that
 * normalises and diffs them.
 *
 * Contract (set by `scripts/augment-pricelist-bootstrap.py`): each workshop
 * sheet listed in `SHEET_TO_WORKSHOP` carries a header row containing the
 * injected columns `Code`, `Kategorie`, `Unterkategorie`, `Einheit`, Mario's
 * curated `Etikett Name` / `Etikett Mass` (the label), and his sale-price
 * column ("Preis Einheit Verkauf"). Columns are located by header text
 * (whitespace/case-insensitive), not position, so Mario can rearrange the calc
 * columns freely. A row is a product iff it has a Code; heading rows are
 * skipped. `Etikett Kategorie` / `Etikett Preis` are ignored (category comes
 * from the injected columns, price from "Preis Einheit Verkauf").
 */

import ExcelJS from "exceljs";
import {
  SHEET_TO_WORKSHOP,
  type PricingModel,
  type RawImportRow,
  type VariantDefs,
} from "@oww/shared";

/** Collapse whitespace (incl. newlines) and lowercase for header matching. */
function normHeader(s: unknown): string {
  return String(s ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Unwrap an ExcelJS cell value to a primitive, preferring a formula's cached result. */
function cellValue(cell: ExcelJS.Cell): string | number | null {
  const v = cell.value;
  if (v == null) return null;
  if (typeof v === "object") {
    // Formula cell: { formula, result } / { sharedFormula, result }.
    if ("result" in v) {
      const r = (v as { result?: unknown }).result;
      if (r == null) return null;
      if (typeof r === "object" && "error" in (r as object)) return null; // #DIV/0! etc.
      return r as string | number;
    }
    if ("error" in v) return null;
    if ("richText" in v) {
      return (v as ExcelJS.CellRichTextValue).richText.map((t) => t.text).join("");
    }
    if ("text" in v) return (v as ExcelJS.CellHyperlinkValue).text;
    return null;
  }
  return v as string | number;
}

function asText(v: string | number | null): string {
  return v == null ? "" : String(v).trim();
}

function asPrice(v: string | number | null): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

const PRICE_HEADER = "preis einheit verkauf";

// The header row sits a handful of rows below a banner + margin notes
// (~row 6–8 in Mario's sheets). Search generously so a taller preamble
// doesn't silently classify a sheet as unconfigured.
const HEADER_SEARCH_ROWS = 50;

interface SheetColumns {
  code: number;
  labelName: number;
  labelMass: number;
  kategorie: number;
  unterkategorie: number;
  einheit: number;
  varianten: number;
  price: number;
  headerRow: number;
}

/** Locate the header row (the one containing "Code") and map the columns we read. */
function locateColumns(ws: ExcelJS.Worksheet): SheetColumns | null {
  for (let r = 1; r <= Math.min(ws.rowCount, HEADER_SEARCH_ROWS); r++) {
    const row = ws.getRow(r);
    const byHeader = new Map<string, number>();
    row.eachCell({ includeEmpty: false }, (cell, col) => {
      byHeader.set(normHeader(cell.value), col);
    });
    if (!byHeader.has("code")) continue;
    const price = [...byHeader.entries()].find(([h]) => h.includes(PRICE_HEADER))?.[1];
    return {
      headerRow: r,
      code: byHeader.get("code")!,
      // Exact "etikett name"/"etikett mass" so they don't collide with the
      // ignored "etikett kategorie"/"etikett preis" columns.
      labelName: byHeader.get("etikett name") ?? -1,
      labelMass: byHeader.get("etikett mass") ?? -1,
      kategorie: byHeader.get("kategorie") ?? -1,
      unterkategorie: byHeader.get("unterkategorie") ?? -1,
      einheit: byHeader.get("einheit") ?? -1,
      varianten: byHeader.get("varianten") ?? -1,
      price: price ?? -1,
    };
  }
  return null;
}

/** Split the comma-separated "Varianten" cell into trimmed variant ids. */
function splitVariantIds(v: string | number | null): string[] {
  return asText(v)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Read the workbook `Varianten` sheet into the variant-definition map the
 * importer expands from: `Variante` (id) / `Bezeichnung` (label) / `Faktor`
 * (area factor) / `Grundmodell` (pricing model). Absent sheet → empty map
 * (workshops without cut variants still import fine).
 */
function readVariantDefs(wb: ExcelJS.Workbook): VariantDefs {
  const defs: VariantDefs = {};
  const ws = wb.getWorksheet("Varianten");
  if (!ws) return defs;
  for (let r = 1; r <= Math.min(ws.rowCount, HEADER_SEARCH_ROWS); r++) {
    const row = ws.getRow(r);
    const byHeader = new Map<string, number>();
    row.eachCell({ includeEmpty: false }, (cell, col) => {
      byHeader.set(normHeader(cell.value), col);
    });
    if (!byHeader.has("variante")) continue;
    const idCol = byHeader.get("variante")!;
    const labelCol = byHeader.get("bezeichnung") ?? -1;
    const factorCol = byHeader.get("faktor") ?? -1;
    const modelCol = byHeader.get("grundmodell") ?? -1;
    if (factorCol < 0) return defs;
    for (let rr = r + 1; rr <= ws.rowCount; rr++) {
      const dataRow = ws.getRow(rr);
      const id = asText(cellValue(dataRow.getCell(idCol)));
      if (!id) continue;
      const factor = asPrice(cellValue(dataRow.getCell(factorCol)));
      if (factor == null) continue;
      const model =
        modelCol > 0 ? asText(cellValue(dataRow.getCell(modelCol))) || "count" : "count";
      defs[id] = {
        label: labelCol > 0 ? asText(cellValue(dataRow.getCell(labelCol))) : id,
        factor,
        pricingModel: model as PricingModel,
      };
    }
    return defs;
  }
  return defs;
}

export interface ParseResult {
  rows: RawImportRow[];
  /** Variant definitions from the `Varianten` sheet (id → label/factor/model). */
  variantDefs: VariantDefs;
  /** Sheets named in the contract but missing from the file. */
  missingSheets: string[];
  /** Sheets present but lacking the Code/import columns (not yet augmented). */
  unconfiguredSheets: string[];
}

/**
 * Parse the workbook buffer into raw import rows across all known sheets.
 * Throws only on a structurally unreadable file; per-sheet problems are
 * reported via `missingSheets` / `unconfiguredSheets` so the caller can
 * surface them without aborting the whole import.
 */
export async function parsePricelistXlsx(buffer: Buffer): Promise<ParseResult> {
  const wb = new ExcelJS.Workbook();
  // ExcelJS bundles its own Buffer typings; the runtime accepts a Node Buffer.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await wb.xlsx.load(buffer as any);

  const rows: RawImportRow[] = [];
  const missingSheets: string[] = [];
  const unconfiguredSheets: string[] = [];
  const variantDefs = readVariantDefs(wb);

  for (const sheetName of Object.keys(SHEET_TO_WORKSHOP)) {
    const ws = wb.getWorksheet(sheetName);
    if (!ws) {
      missingSheets.push(sheetName);
      continue;
    }
    const cols = locateColumns(ws);
    if (!cols || cols.price < 0) {
      unconfiguredSheets.push(sheetName);
      continue;
    }
    for (let r = cols.headerRow + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const code = asText(cellValue(row.getCell(cols.code)));
      if (!code) continue; // heading / blank row
      rows.push({
        sheet: sheetName,
        rowNumber: r,
        code,
        labelName: cols.labelName > 0 ? asText(cellValue(row.getCell(cols.labelName))) : "",
        labelMass: cols.labelMass > 0 ? asText(cellValue(row.getCell(cols.labelMass))) : "",
        kategorie: cols.kategorie > 0 ? asText(cellValue(row.getCell(cols.kategorie))) : "",
        unterkategorie:
          cols.unterkategorie > 0 ? asText(cellValue(row.getCell(cols.unterkategorie))) : "",
        einheit: cols.einheit > 0 ? asText(cellValue(row.getCell(cols.einheit))) : "",
        variantIds:
          cols.varianten > 0 ? splitVariantIds(cellValue(row.getCell(cols.varianten))) : [],
        price: asPrice(cellValue(row.getCell(cols.price))),
      });
    }
  }
  return { rows, variantDefs, missingSheets, unconfiguredSheets };
}
