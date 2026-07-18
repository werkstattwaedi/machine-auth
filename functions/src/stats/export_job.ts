// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Daily watermark-batched export of stats rows to BigQuery (ADR-0039).
 *
 * Four streams, each with its own `export_state/{stream}` watermark doc:
 *  - visits + visit_items  ← closed checkouts (by closedAt)
 *  - machine_usage         ← usage_machine (by endTime)
 *  - bills                 ← paid bills (by paidAt)
 *  - membership_snapshots  ← active memberships, once per Zurich month
 *
 * Per batch: pure row builders → sink.insertRows → only on success advance
 * the watermark. A crash between insert and advance re-exports the batch;
 * the `*_v` dedup views absorb duplicates. Resume cursors are
 * `startAfter(watermark, lastDocId)` — never a bare `>` on the timestamp,
 * which would skip equal-timestamp docs at a page boundary.
 *
 * `runStatsExport` is the exported core (integration tests + backfill script
 * drive it directly); `dailyStatsExport` is the thin onSchedule wrapper.
 * The build-and-insert helpers are shared with erasure's flush-before-delete
 * (ADR-0038), so deletion can never lose unexported statistics.
 */

import * as logger from "firebase-functions/logger";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineString } from "firebase-functions/params";
import {
  DocumentReference,
  FieldPath,
  Firestore,
  QueryDocumentSnapshot,
  Timestamp,
  getFirestore,
} from "firebase-admin/firestore";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { getWorkshopTimezone } from "../util/workshop_timezone";
import { statsSubjectSalt, subjectKey } from "../privacy/subject_key";
import {
  buildBillRow,
  buildMachineUsageRow,
  buildMembershipSnapshotRow,
  buildVisitItemRows,
  buildVisitRow,
  type RowContext,
} from "./row_builders";
import { makeBigQuerySink, type StatsSink } from "./sink";
import { advanceStreamState, getStreamState } from "./watermark";
import type {
  CheckoutEntity,
  CheckoutItemEntity,
  MembershipEntity,
  UsageMachineEntity,
} from "../types/firestore_entities";
import type { BillEntity } from "../invoice/types";

export const statsDataset = defineString("STATS_DATASET", { default: "stats" });

const DEFAULT_BATCH_SIZE = 500;

export interface StatsExportDeps {
  db: Firestore;
  sink: StatsSink;
  salt: string;
  /** Page size per stream per invocation. Tests shrink this to exercise
   *  the pagination cursor; production uses the default. */
  batchSize?: number;
}

export interface StreamResult {
  exported: number;
  drained: boolean;
}

export type StatsExportSummary = Record<string, StreamResult>;

/** Membership lookups are cached per run — is_member is an export-time
 *  (T+1 day) approximation by design, see ADR-0039. */
export type MemberCache = Map<string, boolean>;

async function resolveIsMember(
  db: Firestore,
  cache: MemberCache,
  userRef: DocumentReference | null | undefined
): Promise<boolean> {
  if (!userRef) return false;
  const cached = cache.get(userRef.id);
  if (cached !== undefined) return cached;
  const snap = await db
    .collection("memberships")
    .where("members", "array-contains", userRef)
    .get();
  const isMember = snap.docs.some((d) => d.data().status === "active");
  cache.set(userRef.id, isMember);
  return isMember;
}

/**
 * Build + insert visits/visit_items rows for the given closed-checkout docs.
 * Shared with erasure's flush-before-delete.
 */
export async function insertCheckoutRows(
  deps: StatsExportDeps,
  docs: QueryDocumentSnapshot[],
  ctx: RowContext,
  memberCache: MemberCache
): Promise<void> {
  const visitRows = [];
  const itemRows = [];
  for (const doc of docs) {
    const checkout = doc.data() as CheckoutEntity;
    const subjectId = checkout.userId?.id ?? checkout.firebaseUid ?? null;
    const key = subjectKey(deps.salt, subjectId);
    const isMember = await resolveIsMember(deps.db, memberCache, checkout.userId);
    const itemsSnap = await doc.ref.collection("items").get();
    const items = itemsSnap.docs.map((i) => ({
      id: i.id,
      data: i.data() as CheckoutItemEntity,
    }));
    visitRows.push(
      buildVisitRow(doc.id, checkout, items.map((i) => i.data), key, isMember, ctx)
    );
    itemRows.push(...buildVisitItemRows(doc.id, checkout, items, key, ctx));
  }
  await deps.sink.insertRows("visits", visitRows);
  await deps.sink.insertRows("visit_items", itemRows);
}

/** Build + insert machine_usage rows. Shared with erasure's flush. */
export async function insertUsageRows(
  deps: StatsExportDeps,
  docs: QueryDocumentSnapshot[],
  ctx: RowContext
): Promise<void> {
  const rows = docs.map((doc) => {
    const usage = doc.data() as UsageMachineEntity;
    const key = subjectKey(deps.salt, usage.userId?.id ?? null);
    return buildMachineUsageRow(doc.id, usage, key, ctx);
  });
  await deps.sink.insertRows("machine_usage", rows);
}

/** Build + insert bills rows (paid bills only). Shared with erasure's flush. */
export async function insertBillRows(
  deps: StatsExportDeps,
  docs: QueryDocumentSnapshot[],
  ctx: RowContext
): Promise<void> {
  const rows = docs
    .filter((doc) => (doc.data() as BillEntity).paidAt != null)
    .map((doc) => {
      const bill = doc.data() as BillEntity;
      const key = subjectKey(deps.salt, bill.userId?.id ?? null);
      return buildBillRow(doc.id, bill, key, ctx);
    });
  await deps.sink.insertRows("bills", rows);
}

interface TimestampStream {
  name: string;
  collection: string;
  ageField: string;
  insert: (
    deps: StatsExportDeps,
    docs: QueryDocumentSnapshot[],
    ctx: RowContext,
    memberCache: MemberCache
  ) => Promise<void>;
  /** Extra equality filters applied before the orderBy. */
  filters?: Array<{ field: string; value: unknown }>;
}

const TIMESTAMP_STREAMS: TimestampStream[] = [
  {
    name: "visits",
    collection: "checkouts",
    ageField: "closedAt",
    filters: [{ field: "status", value: "closed" }],
    insert: (deps, docs, ctx, cache) => insertCheckoutRows(deps, docs, ctx, cache),
  },
  {
    name: "machine_usage",
    collection: "usage_machine",
    ageField: "endTime",
    insert: (deps, docs, ctx) => insertUsageRows(deps, docs, ctx),
  },
  {
    name: "bills",
    collection: "bills",
    ageField: "paidAt",
    insert: (deps, docs, ctx) => insertBillRows(deps, docs, ctx),
  },
];

async function exportTimestampStream(
  stream: TimestampStream,
  deps: StatsExportDeps,
  ctx: RowContext,
  memberCache: MemberCache
): Promise<StreamResult> {
  const batchSize = deps.batchSize ?? DEFAULT_BATCH_SIZE;
  const state = await getStreamState(deps.db, stream.name);
  let query = deps.db.collection(stream.collection).limit(batchSize);
  for (const f of stream.filters ?? []) {
    query = query.where(f.field, "==", f.value);
  }
  query = query.orderBy(stream.ageField).orderBy(FieldPath.documentId());
  // A documentId() cursor value must be a real doc id; at the epoch state
  // there is none, and the prefix cursor (skip everything ordered at exactly
  // the epoch timestamp) is equivalent — no real doc sits at epoch.
  query = state.lastDocId
    ? query.startAfter(state.watermark, state.lastDocId)
    : query.startAfter(state.watermark);
  const snap = await query.get();
  if (snap.empty) {
    return { exported: 0, drained: true };
  }
  await stream.insert(deps, snap.docs, ctx, memberCache);
  const last = snap.docs[snap.docs.length - 1];
  await advanceStreamState(deps.db, stream.name, {
    watermark: last.get(stream.ageField) as Timestamp,
    lastDocId: last.id,
  });
  return { exported: snap.size, drained: snap.size < batchSize };
}

/** Zurich month (`yyyy-MM`) that `now` falls in. */
export function zurichMonth(now: Date): string {
  return formatInTimeZone(now, getWorkshopTimezone(), "yyyy-MM");
}

async function exportMembershipSnapshots(
  deps: StatsExportDeps,
  now: Date,
  ctx: RowContext
): Promise<StreamResult> {
  const month = zurichMonth(now);
  const state = await getStreamState(deps.db, "membership_snapshots");
  // lastDocId doubles as the last-snapshotted month marker for this stream.
  if (state.lastDocId === month) {
    return { exported: 0, drained: true };
  }
  const snap = await deps.db
    .collection("memberships")
    .where("status", "==", "active")
    .get();
  const rows = snap.docs.map((doc) => {
    const membership = doc.data() as MembershipEntity;
    const ownerKey = subjectKey(deps.salt, membership.ownerUserId?.id ?? null);
    return buildMembershipSnapshotRow(doc.id, membership, month, ownerKey, ctx);
  });
  await deps.sink.insertRows("membership_snapshots", rows);
  const monthStartUtc = fromZonedTime(`${month}-01T00:00:00`, getWorkshopTimezone());
  await advanceStreamState(deps.db, "membership_snapshots", {
    watermark: Timestamp.fromDate(monthStartUtc),
    lastDocId: month,
  });
  return { exported: rows.length, drained: true };
}

/**
 * One export round: up to `batchSize` docs per stream. Loop until every
 * stream reports `drained` (the wrapper and the backfill script both do).
 */
export async function runStatsExport(
  now: Date,
  deps: StatsExportDeps
): Promise<StatsExportSummary> {
  const ctx: RowContext = { exportedAt: now.toISOString() };
  const memberCache: MemberCache = new Map();
  const summary: StatsExportSummary = {};
  for (const stream of TIMESTAMP_STREAMS) {
    summary[stream.name] = await exportTimestampStream(stream, deps, ctx, memberCache);
  }
  summary["membership_snapshots"] = await exportMembershipSnapshots(deps, now, ctx);
  return summary;
}

/**
 * Daily at 05:00 Europe/Zurich — deliberately before the 06:00 bill run so
 * a day's stats land before new bills mutate. Normal days drain in one
 * round; the loop bound only matters after long outages.
 */
export const dailyStatsExport = onSchedule(
  {
    schedule: "0 5 * * *",
    timeZone: "Europe/Zurich",
    memory: "512MiB",
    timeoutSeconds: 540,
    secrets: [statsSubjectSalt],
  },
  async () => {
    const deps: StatsExportDeps = {
      db: getFirestore(),
      sink: await makeBigQuerySink(statsDataset.value()),
      salt: statsSubjectSalt.value(),
    };
    for (let round = 0; round < 50; round++) {
      const summary = await runStatsExport(new Date(), deps);
      logger.info("stats export round", summary);
      if (Object.values(summary).every((s) => s.drained)) return;
    }
    logger.warn("stats export: still not drained after 50 rounds");
  }
);
