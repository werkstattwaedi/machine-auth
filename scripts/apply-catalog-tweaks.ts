#!/usr/bin/env npx tsx
// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * One-shot tweaks to the per-workshop catalog JSON files after Mike
 * reviewed the post-PR-B picker:
 *
 * 1. Shorten Schleifmittel sub-category names (drop the brand model /
 *    diameter detail; keep only the canonical product + brand in parens
 *    when the brand is the differentiator).
 * 2. Add a per-species level to large Holz sub-trees so the chip filter
 *    has a useful third depth — Massivholz / Sperrholz / MDF / Dübel.
 *    Items whose name has no trailing thickness, or whose stripped
 *    "species" is unique within its parent category, stay at their
 *    current depth.
 * 3. Re-shape Makerspace categories: "FDM", "SLA", "Laser" become the
 *    three Makerspace top-level chips. Plywood + MDF (laser-cuttable
 *    materials) live under Laser. Laser Cutter machine moves to the
 *    Laser top-level too.
 * 4. Label the canonical m² variant on multi-variant Makerspace items
 *    "Per m²" so the variant selector reads cleanly (it currently
 *    falls back to "Standard" when label is absent).
 *
 * Mike's note: this is a manual catalog tweak — the upstream xlsx
 * parser will be revised separately once the result is validated.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const catalogDir = join(__dirname, "seed-data", "catalog");

interface Variant {
  id: string;
  label?: string;
  pricingModel: string;
  unitPrice: { default: number; member?: number };
}

interface CatalogItem {
  id: string;
  code: string;
  name: string;
  workshops: string[];
  category: string[];
  description?: string | null;
  active: boolean;
  userCanAdd: boolean;
  variants: Variant[];
}

function loadCatalog(file: string): CatalogItem[] {
  return JSON.parse(readFileSync(join(catalogDir, file), "utf-8")) as CatalogItem[];
}
function saveCatalog(file: string, items: CatalogItem[]): void {
  writeFileSync(join(catalogDir, file), JSON.stringify(items, null, 2) + "\n");
}

// ── 1. Schleifmittel rename map ─────────────────────────────────────────────

const SCHLEIFMITTEL_RENAME: Record<string, string> = {
  "Schleifscheiben, Festool Excenter, ⌀125mm": "Schleifscheiben (Festool)",
  "Dreick-Schleifblätter, Festool Dreiecksschleifer, DX93":
    "Dreieck-Schleifpapier (Festool)",
  "Schleifstreifen gelocht, Festool Rutscher RS-2":
    "Schleifstreifen (Festool)",
  "Handschleifpaper, Siarex, Bogen 115/280mm": "Handschleifpapier",
  "Schleifband, Makita Elektrofeile, 30/533mm": "Schleifband (Makita)",
};

// ── 2. Species sub-category for large Holz sub-trees ────────────────────────

// Which leaf categories warrant a per-species depth. Other leaves are
// short enough that adding another level just creates single-sibling
// chip rows (which the picker hides anyway).
const SPECIES_LEAF_TARGETS = new Set([
  "Massivholz",
  "Sperrholz-Platten",
  "MDF- und Spanplatten",
  "1- und 3-Schicht-Platten",
  "Rundstab, Länge 1'000mm",
]);

function stripThickness(name: string): string {
  // Trailing "<digits> mm" or "<digits>.<digits> mm", with the digits
  // possibly preceded by punctuation/whitespace.
  return name.replace(/\s+\d+(?:\.\d+)?\s*mm\s*$/, "").trim();
}

function applySpeciesSubcategory(items: CatalogItem[]): void {
  // Bucket items by their current category path. Within each bucket,
  // count how many share the stripped "species" name.
  const buckets = new Map<string, CatalogItem[]>();
  for (const item of items) {
    const leaf = item.category[item.category.length - 1];
    if (!SPECIES_LEAF_TARGETS.has(leaf)) continue;
    const key = item.category.join("/");
    const arr = buckets.get(key) ?? [];
    arr.push(item);
    buckets.set(key, arr);
  }
  for (const bucket of buckets.values()) {
    const speciesCount = new Map<string, number>();
    for (const item of bucket) {
      const species = stripThickness(item.name);
      if (species === item.name) continue; // no thickness to strip
      speciesCount.set(species, (speciesCount.get(species) ?? 0) + 1);
    }
    for (const item of bucket) {
      const species = stripThickness(item.name);
      if (species === item.name) continue;
      if ((speciesCount.get(species) ?? 0) < 2) continue;
      item.category = [...item.category, species];
    }
  }
}

// ── Apply to holz.json ──────────────────────────────────────────────────────

{
  const holz = loadCatalog("holz.json");
  for (const item of holz) {
    const leaf = item.category[item.category.length - 1];
    if (SCHLEIFMITTEL_RENAME[leaf]) {
      item.category = [
        ...item.category.slice(0, -1),
        SCHLEIFMITTEL_RENAME[leaf],
      ];
    }
  }
  applySpeciesSubcategory(holz);
  saveCatalog("holz.json", holz);
  console.log(`holz.json: ${holz.length} entries written`);
  // Summarise new category structure.
  const set = new Set<string>();
  for (const e of holz) set.add(e.category.join(" › "));
  for (const s of [...set].sort()) console.log(`  ${s}`);
}

// ── 3. Makerspace re-shape: FDM / SLA / Laser top-level ────────────────────

{
  const maker = loadCatalog("makerspace.json");
  for (const item of maker) {
    const top = item.category[0];
    const sub = item.category[1];
    // 3D-Druck > FDM / SLA → flatten to top-level FDM / SLA
    if (top === "3D-Druck" && (sub === "FDM" || sub === "SLA")) {
      item.category = [sub];
      continue;
    }
    // Holz > Sperrholz / MDF (laser-cuttable plywood) → Laser > Sperrholz / MDF
    if (top === "Holz" && (sub === "Sperrholz" || sub === "MDF")) {
      item.category = ["Laser", sub];
      continue;
    }
  }
  // ── 4. Label the canonical m² variant on multi-variant items ──
  for (const item of maker) {
    if (item.variants.length <= 1) continue;
    const v0 = item.variants[0];
    if (v0.id === "m2" && !v0.label) v0.label = "Per m²";
  }
  saveCatalog("makerspace.json", maker);
  console.log(`\nmakerspace.json: ${maker.length} entries written`);
  const set = new Set<string>();
  for (const e of maker) set.add(e.category.join(" › "));
  for (const s of [...set].sort()) console.log(`  ${s}`);
}

// ── 3b. Laser Cutter machine → Laser top-level in Makerspace picker ────────

{
  const machines = loadCatalog("machines.json");
  for (const item of machines) {
    if (item.workshops.includes("makerspace") && item.name === "Laser Cutter") {
      item.category = ["Laser"];
    }
  }
  saveCatalog("machines.json", machines);
  console.log(`\nmachines.json: ${machines.length} entries written`);
}
