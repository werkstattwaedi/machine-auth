// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import * as logger from "firebase-functions/logger";
import {
  getFirestore,
  Timestamp,
  type DocumentReference,
  type WriteBatch,
} from "firebase-admin/firestore";
import type {
  CheckoutEntity,
  CheckoutItemEntity,
} from "../../types/firestore_entities";
import {
  entryFeeFor,
  recomputeSummary,
} from "../../invoice/close_checkout_and_get_payment";
import {
  COGNITOFORMS_CATALOG_IDS,
  assertCatalogIdsReady,
} from "./catalog_map";
import {
  checkoutIdForEntry,
  mapEntryToCheckout,
  stripPersonInternals,
  type MappedCheckout,
  type MappedCheckoutItem,
} from "./mappers";
import type { CfEntry } from "./schema_types";
import { CognitoformsClient } from "./api_client";

/**
 * The CognitoForms SelfCheckout form ID. Confirmed via
 * `GET https://www.cognitoforms.com/api/forms`.
 */
export const COGNITOFORMS_FORM_ID = "12";

/** Firestore doc that tracks where the last successful import got to. */
export const SYNC_DOC_PATH = "import_state/cognitoforms";

export interface CognitoformsSyncState {
  lastEntryDateSubmitted: Timestamp | null;
  lastRunAt: Timestamp | null;
  lastRunStatus: "ok" | "partial" | "error";
  lastRunError: string | null;
  importedCount: number;
}

export interface RunImportOptions {
  client: CognitoformsClient;
  /** Override for tests — defaults to live form ID 12. */
  formId?: string;
  /** Override the lower-bound cursor (otherwise loaded from Firestore). */
  sinceIso?: string | null;
  /** Optional upper bound (used by backfill chunks). */
  untilIso?: string | null;
  /** Stop after this many entries processed (defaults to 1000 per run). */
  maxEntries?: number;
}

export interface RunImportResult {
  fetched: number;
  importedCount: number;
  skippedDuplicates: number;
  reconcileWarnings: number;
  newCursorIso: string | null;
}

/**
 * Orchestrator — paginate CognitoForms, dedupe by deterministic doc ID,
 * write checkout + items per entry in a single `WriteBatch`, advance the
 * cursor doc on success.
 *
 * Side-effects: Firestore writes only. Throws on irrecoverable errors so
 * the caller (scheduled fn or callable) sees the failure.
 */
export async function runImport(
  opts: RunImportOptions,
): Promise<RunImportResult> {
  assertCatalogIdsReady();
  const db = getFirestore();
  const formId = opts.formId ?? COGNITOFORMS_FORM_ID;
  const cursorRef = db.doc(SYNC_DOC_PATH) as DocumentReference<CognitoformsSyncState>;
  const cursor = await cursorRef.get();
  const cursorData = (cursor.data() ?? {}) as Partial<CognitoformsSyncState>;
  const sinceIso =
    opts.sinceIso !== undefined
      ? opts.sinceIso
      : cursorData.lastEntryDateSubmitted?.toDate().toISOString() ?? null;

  const filterParts: string[] = ["Entry.Status eq 'Submitted'"];
  if (sinceIso) {
    filterParts.push(`Entry.DateSubmitted gt '${sinceIso}'`);
  }
  if (opts.untilIso) {
    filterParts.push(`Entry.DateSubmitted le '${opts.untilIso}'`);
  }
  const filter = filterParts.join(" and ");

  // Load pricing config once — recomputeSummary needs it for entry fees.
  const pricingDoc = await db.doc("config/pricing").get();
  const configFees =
    (pricingDoc.data() as {
      entryFees?: Record<string, Record<string, number>>;
    } | undefined)?.entryFees ?? null;

  const maxEntries = opts.maxEntries ?? 1000;
  let fetched = 0;
  let imported = 0;
  let skipped = 0;
  let reconcileWarnings = 0;
  let latestSubmittedIso: string | null = sinceIso;

  for await (const entry of opts.client.iterateEntries(formId, {
    filter,
    orderBy: "Entry.DateSubmitted asc",
    top: 100,
    maxEntries,
  })) {
    fetched += 1;
    const result = await processEntry(db, entry, configFees);
    if (result.kind === "imported") {
      imported += 1;
      if (result.reconcileWarning) reconcileWarnings += 1;
    } else {
      skipped += 1;
    }
    const submitted = entry.Entry?.DateSubmitted ?? null;
    if (submitted && (!latestSubmittedIso || submitted > latestSubmittedIso)) {
      latestSubmittedIso = submitted;
    }
  }

  // Advance cursor. We update even when nothing was imported so the next
  // run's $filter window doesn't repeatedly fetch the same tail.
  await cursorRef.set(
    {
      lastEntryDateSubmitted: latestSubmittedIso
        ? Timestamp.fromDate(new Date(latestSubmittedIso))
        : (cursorData.lastEntryDateSubmitted ?? null),
      lastRunAt: Timestamp.now(),
      lastRunStatus: "ok",
      lastRunError: null,
      importedCount: (cursorData.importedCount ?? 0) + imported,
    },
    { merge: true },
  );

  logger.info("CognitoForms import run complete", {
    formId,
    fetched,
    imported,
    skipped,
    reconcileWarnings,
    newCursorIso: latestSubmittedIso,
  });

  return {
    fetched,
    importedCount: imported,
    skippedDuplicates: skipped,
    reconcileWarnings,
    newCursorIso: latestSubmittedIso,
  };
}

interface ProcessEntryResult {
  kind: "imported" | "skipped";
  reconcileWarning?: boolean;
}

async function processEntry(
  db: FirebaseFirestore.Firestore,
  entry: CfEntry,
  configFees: Record<string, Record<string, number>> | null,
): Promise<ProcessEntryResult> {
  let docId: string;
  try {
    docId = checkoutIdForEntry(entry);
  } catch (err) {
    logger.warn("Skipping entry without Entry.Number", {
      entryId: entry.Id,
      err: (err as Error).message,
    });
    return { kind: "skipped" };
  }

  const checkoutRef = db.doc(`checkouts/${docId}`) as DocumentReference<CheckoutEntity>;
  const existing = await checkoutRef.get();
  if (existing.exists) {
    return { kind: "skipped" };
  }

  const mapped = mapEntryToCheckout(entry);

  const batch = db.batch();
  const itemRefs = writeCheckoutWithItems(
    db,
    batch,
    checkoutRef,
    mapped,
    configFees,
  );

  let reconcileWarning = false;
  // Reconcile check — compare computed summary.totalPrice to CognitoForms Total.
  // Build a stand-alone summary using the same logic the batch will write so
  // we can warn without re-reading. recomputeSummary needs item.origin + totalPrice.
  const summary = recomputeSummaryForMapped(mapped, configFees);
  if (Math.abs(summary.totalPrice - mapped.sourceTotal) > 0.01) {
    reconcileWarning = true;
    logger.warn("CognitoForms import reconcile mismatch", {
      docId,
      entryNumber: entry.Entry?.Number,
      computed: summary.totalPrice,
      sourceTotal: mapped.sourceTotal,
      delta: summary.totalPrice - mapped.sourceTotal,
    });
  }

  await batch.commit();
  logger.info("Imported CognitoForms entry", {
    docId,
    entryNumber: entry.Entry?.Number,
    items: itemRefs.length,
    usageType: mapped.usageType,
  });
  return { kind: "imported", reconcileWarning };
}

/**
 * Stage the checkout + items writes onto `batch`. Returns the item doc
 * refs so callers can use them downstream (e.g. updating `checkoutItemRef`
 * pointers — not used here, but kept for symmetry with the native flow).
 */
function writeCheckoutWithItems(
  db: FirebaseFirestore.Firestore,
  batch: WriteBatch,
  checkoutRef: DocumentReference<CheckoutEntity>,
  mapped: MappedCheckout,
  configFees: Record<string, Record<string, number>> | null,
): DocumentReference<CheckoutItemEntity>[] {
  const now = Timestamp.now();
  const created = mapped.createdIso
    ? Timestamp.fromDate(new Date(mapped.createdIso))
    : now;
  const closedAt = mapped.closedIso
    ? Timestamp.fromDate(new Date(mapped.closedIso))
    : now;

  const summary = recomputeSummaryForMapped(mapped, configFees);

  const checkout: CheckoutEntity = {
    userId: null as unknown as DocumentReference, // anonymous import; type allows null on the wire
    status: "closed",
    usageType: mapped.usageType,
    created,
    workshopsVisited: mapped.workshopsVisited,
    persons: mapped.persons.map(stripPersonInternals),
    modifiedBy: "cognitoforms-import",
    modifiedAt: now,
    closedAt,
    notes: null,
    summary,
  };
  batch.set(checkoutRef, checkout);

  const itemRefs: DocumentReference<CheckoutItemEntity>[] = [];
  for (const mappedItem of mapped.items) {
    const itemRef = checkoutRef
      .collection("items")
      .doc() as DocumentReference<CheckoutItemEntity>;
    batch.set(itemRef, mappedItemToEntity(db, mappedItem, now));
    itemRefs.push(itemRef);
  }
  return itemRefs;
}

function mappedItemToEntity(
  db: FirebaseFirestore.Firestore,
  m: MappedCheckoutItem,
  created: Timestamp,
): CheckoutItemEntity {
  const catalogRef = m.catalogKey
    ? (db.doc(
        `catalog/${COGNITOFORMS_CATALOG_IDS[m.catalogKey]}`,
      ) as DocumentReference)
    : null;
  return {
    workshop: m.workshop,
    description: m.description,
    origin: m.origin,
    catalogId: catalogRef,
    created,
    quantity: m.quantity,
    unitPrice: m.unitPrice,
    totalPrice: m.totalPrice,
    pricingModel: m.pricingModel,
    ...(m.formInputs ? { formInputs: m.formInputs } : {}),
  };
}

function recomputeSummaryForMapped(
  mapped: MappedCheckout,
  configFees: Record<string, Record<string, number>> | null,
) {
  return recomputeSummary(
    mapped.persons.map(stripPersonInternals),
    mapped.usageType,
    mapped.items.map((i) => ({
      origin: i.origin,
      totalPrice: i.totalPrice,
    })),
    configFees,
    mapped.tip,
  );
}

// Exported so the test suite can stub the entryFeeFor call without
// spinning up an emulator if needed. Currently unused outside; kept for
// parity with the bill_triggers file.
export const _testables = { entryFeeFor };
