// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * One-off re-emit of `visit_items` rows for already-exported checkouts, so
 * rows exported before `variant_id` / `pricing_model` existed gain them.
 *
 * Deliberately NOT a watermark reset: re-running the visits stream would
 * also re-emit `visits` rows, recomputing `is_member` with today's
 * memberships and rewriting visit history. `visit_items` rows carry no
 * export-time-derived field, so a fresh row only adds the new columns and
 * the `visit_items_v` dedup view picks it up.
 *
 * Only checkouts the daily export has already covered are re-emitted —
 * anything past the visits watermark, or still pending the correction
 * flush, is left to the normal export. Checkouts deleted from Firestore
 * (the 2026-09 cleanup incident) have nothing to re-emit; their existing
 * rows stay untouched, with empty variant columns.
 */

import { FieldPath, Firestore } from "firebase-admin/firestore";
import { subjectKey } from "../privacy/subject_key";
import { buildVisitItemRows, type RowContext } from "./row_builders";
import type { StatsSink } from "./sink";
import { getStreamState, isUnexported } from "./watermark";
import type {
  CheckoutEntity,
  CheckoutItemEntity,
} from "../types/firestore_entities";

export interface ReemitVisitItemsDeps {
  db: Firestore;
  sink: StatsSink;
  salt: string;
  batchSize?: number;
}

export interface ReemitVisitItemsSummary {
  checkouts: number;
  items: number;
  /** Closed/cancelled checkouts left to the daily export. */
  skippedUnexported: number;
}

export async function reemitVisitItems(
  now: Date,
  deps: ReemitVisitItemsDeps
): Promise<ReemitVisitItemsSummary> {
  const batchSize = deps.batchSize ?? 500;
  const ctx: RowContext = { exportedAt: now.toISOString() };
  const visitsState = await getStreamState(deps.db, "visits");
  const summary: ReemitVisitItemsSummary = {
    checkouts: 0,
    items: 0,
    skippedUnexported: 0,
  };

  let lastId: string | null = null;
  for (;;) {
    let query = deps.db
      .collection("checkouts")
      .orderBy(FieldPath.documentId())
      .limit(batchSize);
    if (lastId) query = query.startAfter(lastId);
    const snap = await query.get();
    if (snap.empty) break;
    lastId = snap.docs[snap.docs.length - 1].id;

    const rows = [];
    for (const doc of snap.docs) {
      const checkout = doc.data() as CheckoutEntity;
      if (checkout.status !== "closed" && checkout.status !== "cancelled") continue;
      if (!checkout.closedAt) continue;
      if (
        isUnexported(checkout.closedAt, doc.id, visitsState) ||
        doc.get("statsFlushedAt") === null
      ) {
        summary.skippedUnexported++;
        continue;
      }
      const itemsSnap = await doc.ref.collection("items").get();
      const items = itemsSnap.docs.map((i) => ({
        id: i.id,
        data: i.data() as CheckoutItemEntity,
      }));
      const key = subjectKey(
        deps.salt,
        checkout.userId?.id ?? checkout.firebaseUid ?? null
      );
      rows.push(...buildVisitItemRows(doc.id, checkout, items, key, ctx));
      summary.checkouts++;
    }
    await deps.sink.insertRows("visit_items", rows);
    summary.items += rows.length;
    if (snap.size < batchSize) break;
  }
  return summary;
}
