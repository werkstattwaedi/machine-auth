#!/usr/bin/env npx tsx
// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Generate `scripts/seed-data/catalog/holz.json` from the authoritative
 * Holzwerkstatt-Preisliste xlsx (Mike's source of truth).
 *
 * Usage:
 *   npx tsx scripts/build-catalog-from-xlsx.ts \
 *     /mnt/c/Users/Mike/Downloads/260511_Holzwerkstatt_Bestell-_und_Preisliste.xlsx
 *
 * The script:
 *   - Reads the `Holz PL` (Preisliste) sheet — the customer-facing price
 *     list, not the `Holz BL` supplier order template.
 *   - Walks rows, tracking the current section + sub-section from header
 *     rows (rows where only Column A is populated).
 *   - Emits one catalog entry per data row (Produkt × Stärke for solid
 *     wood / panels / dowels; Produkt alone for Schleifmittel / Varia).
 *   - Categories use the new `string[]` shape: e.g. `["Holzplatten",
 *     "Sperrholz"]`, `["Schleifmittel", "Schleifband (Makita)"]`.
 *   - Generates a stable 20-char Firestore-shaped doc ID per entry. The
 *     IDs are committed to the JSON; reseeds preserve them.
 *
 * The xlsx is NOT a build-time input: this script runs by hand when Mike
 * ships a new pricelist. Output goes to `scripts/seed-data/catalog/holz.json`,
 * which is what `seed-emulator.ts` actually loads.
 */

import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── XML parsing ──────────────────────────────────────────────────────────────

const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

/** Pull one file out of the zip-formatted xlsx. */
function unzipMember(xlsxPath: string, member: string): string {
  return execFileSync("unzip", ["-p", xlsxPath, member], {
    encoding: "utf-8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** Decode the sharedStrings.xml table into a list of plain strings. */
function loadSharedStrings(xlsxPath: string): string[] {
  const xml = unzipMember(xlsxPath, "xl/sharedStrings.xml");
  // Each <si> contains one or more <t> nodes (rich text → multiple <t>).
  // Concatenate all <t> contents per <si>.
  const result: string[] = [];
  const siRegex = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  const tRegex = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
  let siMatch: RegExpExecArray | null;
  while ((siMatch = siRegex.exec(xml)) !== null) {
    let combined = "";
    let tMatch: RegExpExecArray | null;
    const inner = siMatch[1];
    tRegex.lastIndex = 0;
    while ((tMatch = tRegex.exec(inner)) !== null) {
      combined += decodeXmlEntities(tMatch[1]);
    }
    result.push(combined);
  }
  return result;
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

interface Cell {
  col: string;
  value: string | number | null;
}

interface Row {
  num: number;
  cells: Record<string, string | number | null>;
}

/**
 * Resolve a sheet tab name (the human-readable label on the worksheet
 * tab in Excel) to its `xl/worksheets/sheetN.xml` archive path. xlsx
 * sheet numbering is insertion-order — *not* tab position — so a
 * hard-wired `sheet2.xml` silently drifts the moment Mike inserts or
 * re-orders sheets. Resolving through `workbook.xml` + its rels file
 * locks the parser to the named worksheet.
 */
function resolveSheetPath(xlsxPath: string, sheetName: string): string {
  const workbookXml = unzipMember(xlsxPath, "xl/workbook.xml");
  const sheetMatch = new RegExp(
    `<sheet\\b[^>]*\\bname="${sheetName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*\\br:id="([^"]+)"[^>]*/?>`,
  ).exec(workbookXml);
  if (!sheetMatch) {
    throw new Error(
      `build-catalog-from-xlsx: sheet "${sheetName}" not found in xl/workbook.xml`,
    );
  }
  const rId = sheetMatch[1];
  const relsXml = unzipMember(xlsxPath, "xl/_rels/workbook.xml.rels");
  const relMatch = new RegExp(
    `<Relationship\\b[^>]*\\bId="${rId}"[^>]*\\bTarget="([^"]+)"`,
  ).exec(relsXml);
  if (!relMatch) {
    throw new Error(
      `build-catalog-from-xlsx: relationship "${rId}" for sheet "${sheetName}" not found`,
    );
  }
  // Target is relative to xl/ (e.g. "worksheets/sheet2.xml").
  return relMatch[1].startsWith("/") ? relMatch[1].slice(1) : `xl/${relMatch[1]}`;
}

function parseSheet(xlsxPath: string, sheetXmlPath: string, sharedStrings: string[]): Row[] {
  const xml = unzipMember(xlsxPath, sheetXmlPath);
  const rows: Row[] = [];
  const rowRegex = /<row\b[^>]*\br="(\d+)"[^>]*>([\s\S]*?)<\/row>/g;
  const cellRegex =
    /<c\b[^>]*\br="([A-Z]+\d+)"([^/>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let m: RegExpExecArray | null;
  while ((m = rowRegex.exec(xml)) !== null) {
    const num = parseInt(m[1], 10);
    const rowInner = m[2];
    const cells: Record<string, string | number | null> = {};
    let cm: RegExpExecArray | null;
    cellRegex.lastIndex = 0;
    while ((cm = cellRegex.exec(rowInner)) !== null) {
      const ref = cm[1];
      const attrs = cm[2];
      const body = cm[3] ?? "";
      const col = ref.match(/^[A-Z]+/)![0];
      const typeMatch = attrs.match(/\bt="([^"]+)"/);
      const type = typeMatch ? typeMatch[1] : null;
      // `<v xml:space="preserve">…</v>` shows up on cells whose value has
      // leading/trailing whitespace (e.g. " Buche, glatt"), so the open tag
      // can carry attributes. Match the tag generically.
      const valueMatch = body.match(/<v\b[^>]*>([^<]*)<\/v>/);
      const inlineMatch = body.match(/<is>[\s\S]*?<t[^>]*>([^<]*)<\/t>/);
      let value: string | number | null = null;
      if (valueMatch) {
        const raw = valueMatch[1];
        if (type === "s") value = sharedStrings[parseInt(raw, 10)];
        else if (type === "str") value = decodeXmlEntities(raw);
        else value = parseFloat(raw); // n / null type
      } else if (inlineMatch) {
        value = decodeXmlEntities(inlineMatch[1]);
      }
      cells[col] = value;
    }
    rows.push({ num, cells });
  }
  return rows;
}

// ── Catalog entry shape ──────────────────────────────────────────────────────

interface CatalogEntry {
  id: string;
  code: string;
  name: string;
  workshops: string[];
  category: string[];
  description: null;
  active: boolean;
  userCanAdd: boolean;
  variants: Array<{
    id: string;
    pricingModel: "time" | "area" | "length" | "count" | "weight" | "direct" | "sla";
    unitPrice: { default: number };
  }>;
}

// ── Section state machine ────────────────────────────────────────────────────

const TOP_LEVEL_SECTIONS = new Set([
  "Massivholz",
  "Holzplatten",
  "Dübel- und Rundstäbe",
  "Schleifmittel",
  "Varia",
]);

const BANNER_ROWS = new Set([
  "Holzwerkstatt Preisliste",
  "Massivholz und Holzplatten",
]);

/**
 * Map the column-C price header + current section to the canonical
 * `pricingModel`. We have one known oddity: the Schleifmittel sub-headers
 * label the price column "Preis/m" even though the products (sanding
 * discs, sheets) are sold per piece. Override that to `count`.
 */
function pricingModelFromHeader(
  header: string,
  topLevelSection: string | null,
): CatalogEntry["variants"][0]["pricingModel"] {
  if (topLevelSection === "Schleifmittel") return "count";
  // Accept both the ASCII "m2" (today's xlsx) and the Unicode "m²"
  // (what Excel renders by default) so a future revision that pastes
  // the superscript doesn't silently fall through to "length".
  if (header.startsWith("Preis/m2") || header.startsWith("Preis/m²")) {
    return "area";
  }
  if (header.startsWith("Preis/Stk")) return "count";
  if (header.startsWith("Preis/m")) return "length";
  return "count";
}

// ── Stable ID generator ──────────────────────────────────────────────────────

const FIRESTORE_ID_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/**
 * Generate a Firestore-shaped 20-char ID seeded from the entry's logical
 * identity (section + sub-section + product + thickness). Determinism
 * means re-running the parser on the same xlsx produces the same IDs —
 * matches Mike's "stable across reseeds" requirement.
 */
function deterministicId(seed: string): string {
  // Simple FNV-1a hash over the seed, then sample the alphabet 20 times
  // using a linear-congruential PRNG with the hash as the seed. Output
  // looks indistinguishable from a Firestore auto-id; it just happens
  // to be reproducible.
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  let state = h;
  let out = "";
  for (let i = 0; i < 20; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    out += FIRESTORE_ID_ALPHABET[state % FIRESTORE_ID_ALPHABET.length];
  }
  return out;
}

// ── Main parser ──────────────────────────────────────────────────────────────

function buildHolzCatalog(xlsxPath: string): CatalogEntry[] {
  const sharedStrings = loadSharedStrings(xlsxPath);
  const sheetPath = resolveSheetPath(xlsxPath, "Holz PL");
  const rows = parseSheet(xlsxPath, sheetPath, sharedStrings);

  const entries: CatalogEntry[] = [];
  let topLevelSection: string | null = null;
  let subSection: string | null = null;
  let pricingModel: CatalogEntry["variants"][0]["pricingModel"] = "count";
  let inDataBlock = false;
  let currentProduct: string | null = null;
  let codeCounter = 0; // sequential within the Holzwerkstatt; 3000 + counter

  const setSection = (s: string) => {
    topLevelSection = s;
    subSection = null;
    inDataBlock = false;
    currentProduct = null;
  };

  for (const row of rows) {
    const a = row.cells["A"];
    const b = row.cells["B"];
    const c = row.cells["C"];

    // Banner / title — skip.
    if (typeof a === "string" && BANNER_ROWS.has(a)) {
      continue;
    }

    // Fully empty row — block boundary.
    if (a == null && b == null && c == null) {
      inDataBlock = false;
      currentProduct = null;
      continue;
    }

    // Section header (only A populated, B + C empty).
    if (a != null && b == null && c == null) {
      const text = String(a).trim();
      if (TOP_LEVEL_SECTIONS.has(text)) {
        setSection(text);
      } else {
        // Sub-section header within the current top-level section.
        subSection = text;
        inDataBlock = false;
        currentProduct = null;
      }
      continue;
    }

    // Column-header row: A=Produkt, B=optional Stärke, C=Preis/*
    if (a === "Produkt" && (typeof c === "string") && c.startsWith("Preis/")) {
      pricingModel = pricingModelFromHeader(c, topLevelSection);
      inDataBlock = true;
      currentProduct = null;
      continue;
    }

    if (!inDataBlock) continue;
    if (topLevelSection == null) continue;

    // Data row. Inherit produkt name from the previous row when A is blank.
    const produktRaw = a == null ? currentProduct : String(a).trim();
    if (produktRaw == null) continue;
    currentProduct = produktRaw;

    const price = typeof c === "number" ? c : c != null ? parseFloat(String(c)) : NaN;
    if (!Number.isFinite(price) || price <= 0) continue;

    // Build the catalog item.
    const staerkeRaw = b == null ? null : String(b).trim();
    const staerkeLabel = formatStaerke(staerkeRaw);
    const name = staerkeLabel ? `${produktRaw} ${staerkeLabel}` : produktRaw;

    const category = buildCategory(topLevelSection, subSection);

    codeCounter += 1;
    const code = String(3000 + codeCounter);

    const id = deterministicId(
      `${topLevelSection}|${subSection ?? ""}|${produktRaw}|${staerkeRaw ?? ""}`,
    );

    entries.push({
      id,
      code,
      name,
      workshops: ["holz"],
      category,
      description: null,
      active: true,
      userCanAdd: true,
      variants: [
        {
          id: "default",
          pricingModel,
          unitPrice: { default: round2(price) },
        },
      ],
    });
  }

  return entries;
}

function formatStaerke(raw: string | null): string | null {
  if (raw == null || raw === "") return null;
  // Existing values come in three flavours:
  //   - bare number (24, 30, 40)
  //   - already-suffixed (4 mm, 21 mm)
  // Normalise to "<n> mm".
  const m = raw.match(/^(\d+(?:\.\d+)?)\s*(mm)?$/);
  if (m) return `${m[1]} mm`;
  return raw;
}

function buildCategory(section: string, sub: string | null): string[] {
  const path: string[] = [section];
  if (sub) path.push(normalizeSubcategory(section, sub));
  return path;
}

/**
 * Light cosmetic tidy-up of the sub-section label so it reads cleanly in
 * the picker chips. The xlsx labels are very specific ("Schleifscheiben,
 * Festool Excenter, ⌀125mm") — fine as catalog metadata, but we trim the
 * runs of comma-separated brand info from the picker label when there's
 * a shorter form. For now: pass through verbatim. Mike can refine later.
 */
function normalizeSubcategory(_section: string, sub: string): string {
  return sub;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── Entry point ──────────────────────────────────────────────────────────────

function main(): void {
  const xlsxArg = process.argv[2];
  if (!xlsxArg) {
    console.error(
      "Usage: npx tsx scripts/build-catalog-from-xlsx.ts <path-to-xlsx>",
    );
    process.exit(2);
  }
  const entries = buildHolzCatalog(xlsxArg);

  // Sanity logging.
  const byCategory = new Map<string, number>();
  for (const e of entries) {
    const key = e.category.join(" > ");
    byCategory.set(key, (byCategory.get(key) ?? 0) + 1);
  }
  console.log(`Parsed ${entries.length} Holz catalog entries:`);
  for (const [k, v] of [...byCategory.entries()].sort()) {
    console.log(`  ${v.toString().padStart(4)}  ${k}`);
  }

  const outPath = join(__dirname, "seed-data", "catalog", "holz.json");
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(entries, null, 2) + "\n");
  console.log(`Wrote ${outPath}`);
}

main();
