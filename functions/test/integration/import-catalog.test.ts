// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

process.env.FUNCTIONS_EMULATOR = "true";

import { expect } from "chai";
import ExcelJS from "exceljs";
import {
  setupEmulator,
  clearFirestore,
  teardownEmulator,
  getFirestore,
} from "../emulator-helper";
import {
  previewCatalogImport,
  applyCatalogImport,
} from "../../src/catalog/import_catalog";

const ADMIN_UID = "admin-test";

interface FixtureRow {
  code?: string | number;
  labelName?: string;
  labelMass?: string;
  kategorie?: string;
  unter?: string;
  einheit?: string;
  /** Comma-separated variant ids for the "Varianten" column. */
  varianten?: string;
  price?: number | null;
  heading?: string; // emits a heading row (only col A) instead of a data row
}

interface FixtureVariantDef {
  label: string;
  factor: number;
  pricingModel: string;
}

/**
 * Build a minimal pricelist workbook in memory. Header layout mirrors the
 * bootstrap output: injected Code/Kategorie/Unterkategorie/Einheit + Mario's
 * curated Etikett Name / Etikett Mass + the "Preis Einheit Verkauf" sale-price
 * column + the "Varianten" column, with a banner + heading row above the header
 * to exercise the header-locating logic. `Etikett Kategorie`/`Etikett Preis` are
 * included but ignored by the parser. `defs` (when passed) emits the global
 * `Varianten` definition sheet the importer expands cut options from.
 */
async function buildFixture(
  sheets: Record<string, FixtureRow[]>,
  defs?: Record<string, FixtureVariantDef>
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const [name, rows] of Object.entries(sheets)) {
    const ws = wb.addWorksheet(name);
    ws.addRow([`${name} – Bestellliste`]); // banner
    // Leading "Pos" column mirrors the real file, where Code sits to the right
    // of Mario's calc columns and section headings live in column A.
    ws.addRow([
      "Pos", "Code", "Kategorie", "Unterkategorie", "Einheit",
      "Etikett Kategorie", "Etikett Name", "Etikett Mass", "Etikett Preis",
      "Preis Einheit\nVerkauf", "Varianten",
    ]);
    for (const r of rows) {
      if (r.heading != null) {
        ws.addRow([r.heading]); // heading text in column A; Code column empty
        continue;
      }
      ws.addRow([
        "", r.code ?? "", r.kategorie ?? "", r.unter ?? "", r.einheit ?? "",
        "ignored", r.labelName ?? "", r.labelMass ?? "", "ignored",
        r.price ?? null, r.varianten ?? "",
      ]);
    }
  }
  if (defs) {
    const vs = wb.addWorksheet("Varianten");
    vs.addRow(["Variante", "Bezeichnung", "Faktor", "Grundmodell"]);
    for (const [id, def] of Object.entries(defs)) {
      vs.addRow([id, def.label, def.factor, def.pricingModel]);
    }
  }
  return (await wb.xlsx.writeBuffer()) as unknown as Buffer;
}

async function seedItem(over: Record<string, unknown>): Promise<string> {
  const ref = getFirestore().collection("catalog").doc();
  await ref.set({
    code: "0",
    name: "x",
    workshops: ["holz"],
    category: ["Massivholz"],
    active: true,
    userCanAdd: true,
    variants: [{ id: "default", pricingModel: "area", unitPrice: { default: 1 } }],
    ...over,
  });
  return ref.id;
}

describe("catalog import (Integration)", () => {
  before(async function () {
    this.timeout(10000);
    await setupEmulator();
  });
  after(async () => {
    await teardownEmulator();
  });
  beforeEach(async () => {
    await clearFirestore();
  });

  it("parses the sheets, composing name from the Etikett label pair", async () => {
    const buffer = await buildFixture({
      Holz: [
        { heading: "Massivholz" },
        { code: "3001", labelName: "Ahorn", labelMass: "24 mm", kategorie: "Massivholz", unter: "Ahorn", einheit: "m²", price: 57.6 },
        { labelName: "no code, skipped", einheit: "m²", price: 9 },
        { code: "3002", labelName: "Zero price, skipped", kategorie: "Massivholz", einheit: "m²", price: 0 },
      ],
      Metall: [
        { code: "2001", labelName: "Flachstahl", labelMass: "15 × 2 mm", kategorie: "Flachstahl", einheit: "lm", price: 1.95 },
      ],
      Keramik: [
        { code: "4216", labelName: "B128", kategorie: "Tone", einheit: "kg", price: 3.25 },
      ],
      Textil: [
        { code: "7001", labelName: "Siebdrucksieb", labelMass: "A4+", kategorie: "Siebdruck", einheit: "Stk", price: 28.7 },
      ],
    });

    const preview = await previewCatalogImport(buffer);
    expect(preview.summary.create).to.equal(4); // one per sheet
    expect(preview.summary.errors).to.equal(1); // the zero-price row (no-code is silently skipped)
    const ahorn = preview.diff.find((d) => d.code === "3001");
    expect(ahorn?.entry?.workshops).to.deep.equal(["holz"]);
    expect(ahorn?.entry?.name).to.equal("Ahorn 24 mm"); // composed from label pair
    expect(ahorn?.entry?.labelName).to.equal("Ahorn");
    expect(ahorn?.entry?.labelMass).to.equal("24 mm");
    expect(preview.diff.find((d) => d.code === "2001")?.entry?.variants[0].pricingModel).to.equal("length");
    // A blank Etikett Mass composes to just the name.
    expect(preview.diff.find((d) => d.code === "4216")?.entry?.name).to.equal("B128");
  });

  it("expands makerspace laser variants from the Varianten sheet; SLA maps to sla", async () => {
    const buffer = await buildFixture(
      {
        Makerspace: [
          { code: "6011", labelName: "MDF roh", labelMass: "3 mm", kategorie: "Laser", unter: "MDF", einheit: "m²", varianten: "a3,500-1250", price: 5.55 },
          { code: "9101", labelName: "Clear Resin", kategorie: "SLA", einheit: "L", price: 150 },
        ],
      },
      {
        a3: { label: "Zuschnitt A3", factor: 0.126, pricingModel: "count" },
        "500-1250": { label: "Zuschnitt 500 × 1250 mm", factor: 0.625, pricingModel: "count" },
      },
    );
    const preview = await previewCatalogImport(buffer);
    const mdf = preview.diff.find((d) => d.code === "6011")?.entry;
    expect(mdf?.workshops).to.deep.equal(["makerspace"]);
    expect(mdf?.variants).to.have.length(3);
    expect(mdf?.variants[0]).to.include({ id: "default", label: "Per m²", pricingModel: "area" });
    expect(mdf?.variants[1]).to.include({ id: "a3", pricingModel: "count" });
    expect(mdf?.variants[1].unitPrice.default).to.equal(0.7); // 5.55 × 0.126 → 0.70
    expect(mdf?.variants[2].unitPrice.default).to.equal(3.45); // 5.55 × 0.625 → 3.45
    // SLA resin (Einheit "L") maps to the sla pricing model.
    expect(preview.diff.find((d) => d.code === "9101")?.entry?.variants[0].pricingModel).to.equal("sla");
  });

  it("classifies create / update / unchanged / retire against the live catalog", async () => {
    const unchangedId = await seedItem({ code: "3001", name: "Ahorn 24 mm", labelName: "Ahorn", labelMass: "24 mm", category: ["Massivholz", "Ahorn"], variants: [{ id: "default", pricingModel: "area", unitPrice: { default: 57.6 } }] });
    const changedId = await seedItem({ code: "3002", name: "Arve 24 mm", labelName: "Arve", labelMass: "24 mm", category: ["Massivholz", "Arve"], variants: [{ id: "default", pricingModel: "area", unitPrice: { default: 80 } }] });
    const retireId = await seedItem({ code: "3099", name: "Discontinued", category: ["Massivholz"] });

    const buffer = await buildFixture({
      Holz: [
        { code: "3001", labelName: "Ahorn", labelMass: "24 mm", kategorie: "Massivholz", unter: "Ahorn", einheit: "m²", price: 57.6 },
        { code: "3002", labelName: "Arve", labelMass: "24 mm", kategorie: "Massivholz", unter: "Arve", einheit: "m²", price: 84.5 },
        { code: "3003", labelName: "Eiche", labelMass: "24 mm", kategorie: "Massivholz", unter: "Eiche", einheit: "m²", price: 60 },
      ],
    });

    const preview = await previewCatalogImport(buffer);
    expect(preview.diff.find((d) => d.id === unchangedId)?.kind).to.equal("unchanged");
    const upd = preview.diff.find((d) => d.id === changedId);
    expect(upd?.kind).to.equal("update");
    expect(upd?.changes).to.deep.include({ field: "price", from: 80, to: 84.5 });
    expect(preview.diff.find((d) => d.code === "3003")?.kind).to.equal("create");
    expect(preview.diff.find((d) => d.id === retireId)?.kind).to.equal("retire");
  });

  it("applies creates + updates, preserving member price; gates retirement behind the flag", async () => {
    const memberId = await seedItem({
      code: "3002",
      name: "Arve 24 mm",
      variants: [{ id: "default", pricingModel: "area", unitPrice: { default: 80, member: 70 } }],
    });
    const retireId = await seedItem({ code: "3099", name: "Discontinued" });

    const buffer = await buildFixture({
      Holz: [
        { code: "3002", labelName: "Arve", labelMass: "24 mm", kategorie: "Massivholz", unter: "Arve", einheit: "m²", price: 84.5 },
        { code: "3003", labelName: "Eiche", labelMass: "24 mm", kategorie: "Massivholz", unter: "Eiche", einheit: "m²", price: 60 },
      ],
    });

    // First apply WITHOUT retire — the discontinued item stays active.
    const r1 = await applyCatalogImport(buffer, false, ADMIN_UID);
    expect(r1.created).to.equal(1);
    expect(r1.updated).to.equal(1);
    expect(r1.retired).to.equal(0);

    const db = getFirestore();
    const member = (await db.collection("catalog").doc(memberId).get()).data();
    expect(member?.variants[0].unitPrice.default).to.equal(84.5);
    expect(member?.variants[0].unitPrice.member).to.equal(70); // preserved
    expect(member?.modifiedBy).to.equal(ADMIN_UID);

    const created = (await db.collection("catalog").where("code", "==", "3003").get()).docs[0]?.data();
    expect(created?.name).to.equal("Eiche 24 mm");
    expect(created?.labelName).to.equal("Eiche");
    expect(created?.labelMass).to.equal("24 mm");
    expect(created?.active).to.be.true;

    expect((await db.collection("catalog").doc(retireId).get()).data()?.active).to.be.true;

    // Re-apply WITH retire — now the discontinued item is deactivated.
    const r2 = await applyCatalogImport(buffer, true, ADMIN_UID);
    expect(r2.retired).to.equal(1);
    expect((await db.collection("catalog").doc(retireId).get()).data()?.active).to.be.false;
  });

  it("collapses an uncalculated workbook into one hint and refuses to apply it", async () => {
    // Openpyxl output (e.g. the augment script's "– mit Codes" file):
    // every price cell is a formula with no cached result.
    const buffer = await buildFixture({
      Holz: [
        { code: "3001", labelName: "Ahorn", labelMass: "24 mm", kategorie: "Massivholz", einheit: "m²", price: null },
        { code: "3002", labelName: "Arve", labelMass: "24 mm", kategorie: "Massivholz", einheit: "m²", price: null },
      ],
    });
    const preview = await previewCatalogImport(buffer);
    expect(preview.hints[0]).to.match(/Excel/);
    expect(preview.summary.create).to.equal(0);
    // The per-row "Kein gültiger Verkaufspreis" errors are redundant with
    // the hint and must not drown it out.
    expect(preview.issues.filter((i) => i.kind === "no-price")).to.have.length(0);
    expect(preview.summary.errors).to.equal(0);

    // Applying such a workbook is never right — with all rows dropped the
    // diff would read the whole catalog as retirable.
    try {
      await applyCatalogImport(buffer, false, ADMIN_UID);
      expect.fail("apply should have thrown");
    } catch (err) {
      expect(String(err)).to.match(/Excel/);
    }
  });

  it("keeps per-row price errors when only a few rows are uncalculated", async () => {
    // Glas-style breakage: a minority of rows carry #N/A / missing prices.
    const buffer = await buildFixture({
      Holz: [
        { code: "3001", labelName: "Ahorn", labelMass: "24 mm", kategorie: "Massivholz", einheit: "m²", price: 84.5 },
        { code: "3002", labelName: "Arve", labelMass: "24 mm", kategorie: "Massivholz", einheit: "m²", price: 60 },
        { code: "3003", labelName: "Eiche", labelMass: "24 mm", kategorie: "Massivholz", einheit: "m²", price: null },
      ],
    });
    const preview = await previewCatalogImport(buffer);
    expect(preview.hints).to.have.length(0);
    const priceIssues = preview.issues.filter((i) => i.kind === "no-price");
    expect(priceIssues).to.have.length(1);
    expect(priceIssues[0].message).to.contain("3003");
    expect(preview.summary.errors).to.equal(1);
  });

  it("reports missing / unconfigured sheets without throwing", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Holz");
    ws.addRow(["Anzahl", "Format", "Produkt"]); // no Code column → unconfigured
    const buffer = (await wb.xlsx.writeBuffer()) as unknown as Buffer;

    const preview = await previewCatalogImport(buffer);
    expect(preview.unconfiguredSheets).to.include("Holz");
    expect(preview.missingSheets).to.include.members(["Metall", "Keramik", "Textil", "Glas"]);
    expect(preview.summary.create).to.equal(0);
  });
});
