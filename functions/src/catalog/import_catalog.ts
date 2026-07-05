// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Catalog bulk import from Mario's pricelist xlsx (preview + apply).
 *
 * Flow: the admin UI uploads the workbook (base64). `previewCatalogImport`
 * parses it, diffs against the live catalog and returns a dry-run; the admin
 * reviews it and calls `applyCatalogImport` (same file) to commit.
 *
 * The parse → normalise → diff pipeline is shared with the preview, so apply
 * always acts on a *fresh* diff against the catalog as it stands at commit
 * time — the uploaded file, not the previewed diff, is the source of truth.
 *
 * Updates patch only `variants[0]`'s default price + pricing model and the
 * name/category/workshops/active fields; any member tier or extra variants
 * on the existing item are preserved (the xlsx only knows the default price).
 * Retirements (active → false) are gated behind an explicit flag because they
 * are the destructive part of an import.
 */

import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { getFirestore, type DocumentData } from "firebase-admin/firestore";
import {
  parsePricelistXlsx,
  type ParseResult,
} from "./parse_pricelist_xlsx";
import {
  buildImportPreview,
  type CurrentCatalogItem,
  type ImportPreview,
  type ImportEntry,
} from "@oww/shared";
import { handleUpsertCatalogItem } from "./upsert_catalog_item";

const MAX_BATCH_OPS = 450; // Firestore caps a WriteBatch at 500; leave headroom.

interface LoadedCatalog {
  current: CurrentCatalogItem[];
  data: Map<string, DocumentData>;
}

async function loadCatalog(): Promise<LoadedCatalog> {
  const snap = await getFirestore().collection("catalog").get();
  const current: CurrentCatalogItem[] = [];
  const data = new Map<string, DocumentData>();
  for (const doc of snap.docs) {
    const d = doc.data();
    const v0 = Array.isArray(d.variants) ? d.variants[0] : undefined;
    current.push({
      id: doc.id,
      code: String(d.code ?? ""),
      name: String(d.name ?? ""),
      labelName: d.labelName ?? null,
      labelMass: d.labelMass ?? null,
      category: Array.isArray(d.category) ? d.category.map(String) : [],
      workshops: Array.isArray(d.workshops) ? d.workshops.map(String) : [],
      active: d.active !== false,
      type: d.type ?? null,
      pricingModel: String(v0?.pricingModel ?? ""),
      unitPrice: Number(v0?.unitPrice?.default ?? NaN),
    });
    data.set(doc.id, d);
  }
  return { current, data };
}

export interface PreviewResult extends ImportPreview {
  missingSheets: string[];
  unconfiguredSheets: string[];
  /** Prominent, non-row-specific guidance for the admin (e.g. uncached prices). */
  hints: string[];
}

/**
 * Excel stores the *result* of a formula in the file; a workbook written by a
 * tool that doesn't evaluate formulas (e.g. the bootstrap script) has no
 * cached price. Detect the "almost everything has no price" case and explain
 * it once, instead of drowning the admin in 200 per-row price errors.
 */
function priceHint(parsed: ParseResult): string[] {
  if (parsed.rows.length === 0) return [];
  const noPrice = parsed.rows.filter((r) => r.price == null).length;
  if (noPrice / parsed.rows.length > 0.5) {
    return [
      `${noPrice} von ${parsed.rows.length} Zeilen haben keinen berechneten Preis. ` +
        "Die Datei zuerst in Excel öffnen und speichern, damit die Verkaufspreis-Formeln berechnet werden.",
    ];
  }
  return [];
}

/** Parse + diff the uploaded workbook against the live catalog (no writes). */
export async function previewCatalogImport(buffer: Buffer): Promise<PreviewResult> {
  const parsed: ParseResult = await parsePricelistXlsx(buffer);
  const { current } = await loadCatalog();
  const preview = buildImportPreview(parsed.rows, current);
  return {
    ...preview,
    missingSheets: parsed.missingSheets,
    unconfiguredSheets: parsed.unconfiguredSheets,
    hints: priceHint(parsed),
  };
}

export interface ApplyResult {
  created: number;
  updated: number;
  unchanged: number;
  retired: number;
  errors: number;
  warnings: number;
}

/** Merge a fresh default price + pricing model into an existing item's variants. */
function patchedVariants(existing: DocumentData, entry: ImportEntry): unknown[] {
  const variants = Array.isArray(existing.variants) && existing.variants.length
    ? [...existing.variants]
    : [{ id: "default", pricingModel: entry.pricingModel, unitPrice: {} }];
  const v0 = { ...variants[0] };
  v0.pricingModel = entry.pricingModel;
  v0.unitPrice = { ...(v0.unitPrice ?? {}), default: entry.unitPrice.default };
  variants[0] = v0;
  return variants;
}

/**
 * Apply the import: create new items, update changed ones, and — when
 * `applyRetire` — deactivate materials absent from the file. Reuses the
 * shared diff against a freshly-loaded catalog.
 */
export async function applyCatalogImport(
  buffer: Buffer,
  applyRetire: boolean,
  actorUid: string | null
): Promise<ApplyResult> {
  const parsed = await parsePricelistXlsx(buffer);
  const { current, data } = await loadCatalog();
  const preview = buildImportPreview(parsed.rows, current);

  const db = getFirestore();
  const collection = db.collection("catalog");
  const now = new Date();

  let created = 0;
  let updated = 0;
  let retired = 0;

  // Creates introduce a *new* code, so they must go through the same
  // transactional uniqueness guard the rules rely on (ADR-0026); the diff's
  // byCode map is a stale snapshot and can't protect against a concurrent
  // write. handleUpsertCatalogItem runs that check per code. Updates/retires
  // target a known doc id and never change the code, so they carry no
  // collision risk and stay on the fast batched-write path.
  for (const d of preview.diff) {
    if (d.kind === "create" && d.entry) {
      const entry = d.entry;
      await handleUpsertCatalogItem(
        {
          code: entry.code,
          name: entry.name,
          labelName: entry.labelName,
          labelMass: entry.labelMass,
          description: null,
          workshops: entry.workshops,
          category: entry.category,
          active: true,
          userCanAdd: entry.userCanAdd,
          variants: [
            { id: "default", pricingModel: entry.pricingModel, unitPrice: { default: entry.unitPrice.default } },
          ],
        },
        actorUid
      );
      created++;
    }
  }

  // Collect update/retire ops, then flush in <=MAX_BATCH_OPS chunks.
  const ops: Array<(batch: FirebaseFirestore.WriteBatch) => void> = [];
  for (const d of preview.diff) {
    if (d.kind === "update" && d.entry && d.id) {
      const ref = collection.doc(d.id);
      const entry = d.entry;
      const existing = data.get(d.id) ?? {};
      const variants = patchedVariants(existing, entry);
      ops.push((batch) =>
        batch.set(
          ref,
          {
            name: entry.name,
            labelName: entry.labelName,
            labelMass: entry.labelMass,
            workshops: entry.workshops,
            category: entry.category,
            active: true,
            variants,
            modifiedBy: actorUid,
            modifiedAt: now,
          },
          { merge: true }
        )
      );
      updated++;
    } else if (d.kind === "retire" && applyRetire && d.id) {
      const ref = collection.doc(d.id);
      ops.push((batch) =>
        batch.set(ref, { active: false, modifiedBy: actorUid, modifiedAt: now }, { merge: true })
      );
      retired++;
    }
  }

  for (let i = 0; i < ops.length; i += MAX_BATCH_OPS) {
    const batch = db.batch();
    for (const op of ops.slice(i, i + MAX_BATCH_OPS)) op(batch);
    await batch.commit();
  }

  return {
    created,
    updated,
    unchanged: preview.summary.unchanged,
    retired,
    errors: preview.summary.errors,
    warnings: preview.summary.warnings,
  };
}

// ── Callable wrappers ─────────────────────────────────────────────────────────

function requireAdmin(request: CallableRequest<unknown>): string {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required");
  }
  if (request.auth.token.admin !== true) {
    throw new HttpsError("permission-denied", "Admin role required");
  }
  return request.auth.uid;
}

function decodeFile(payload: unknown): Buffer {
  const data = payload as { fileBase64?: unknown } | null;
  if (!data || typeof data.fileBase64 !== "string" || data.fileBase64.length === 0) {
    throw new HttpsError("invalid-argument", "fileBase64 (xlsx) is required");
  }
  // Buffer.from(..., "base64") never throws — it silently drops non-base64
  // chars — so a malformed upload surfaces as an ExcelJS parse error
  // downstream rather than here.
  return Buffer.from(data.fileBase64, "base64");
}

export const previewCatalogImportHandler = async (request: CallableRequest<unknown>) => {
  requireAdmin(request);
  return previewCatalogImport(decodeFile(request.data));
};

export const applyCatalogImportHandler = async (request: CallableRequest<unknown>) => {
  const uid = requireAdmin(request);
  const data = request.data as { applyRetire?: unknown };
  const applyRetire = data?.applyRetire === true;
  return applyCatalogImport(decodeFile(request.data), applyRetire, uid);
};
