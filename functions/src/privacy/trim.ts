// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Yearly retention trim (ADR-0038): delete operational data older than
 * the 3-year retention cutoff, per the subject-data map's trim entries.
 *
 * MANUALLY triggered (`authCall/privacyTrim`, driven by
 * `scripts/privacy-cli.ts trim`): destructive, annual, and the dry-run
 * review of per-collection counts is the safety valve. No cron by design;
 * convertible to onSchedule later if chronically forgotten.
 *
 * Guards:
 *  - Export-watermark: a doc the daily BigQuery export has not covered yet
 *    is never deleted (skipped + counted; the next export picks it up).
 *  - pendingRenewalBill: a bill referenced by a non-null
 *    memberships.pendingRenewalBill is never deleted (a >3y bill can't
 *    normally be pending — cheap insurance against a forever-skipped
 *    renewal).
 *  - Invoice PDFs move to the escrow archive bucket before their bill doc
 *    is deleted (OR Art. 958f, see privacy/archive.ts).
 *
 * Dry-run pages through the same queries without writing, so the reviewed
 * counts are exact, not estimates.
 */

import * as logger from "firebase-functions/logger";
import {
  Firestore,
  Query,
  QueryDocumentSnapshot,
  Timestamp,
  getFirestore,
} from "firebase-admin/firestore";
import { fromZonedTime } from "date-fns-tz";
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { getWorkshopTimezone } from "../util/workshop_timezone";
import { getStreamState, isUnexported, type StreamState } from "../stats/watermark";
import { moveInvoicePdfToArchive } from "./archive";
import { RETENTION_YEARS } from "./subject_data_map";
import { logOperationInfo } from "../operations_log";
import type { BillEntity } from "../invoice/types";

const PAGE = 500;
const BATCH_LIMIT = 400;

export interface TrimOutcome {
  cutoff: string;
  dryRun: boolean;
  /** Docs deleted (or would-be, for dryRun) per collection. */
  counts: Record<string, number>;
  /** Pre-cutoff docs left in place because the export hasn't covered them. */
  skippedUnexported: number;
  /** Bills left in place because a membership renewal still references them. */
  skippedPendingRenewal: number;
  archivedPdfs: number;
}

interface TrimContext {
  db: Firestore;
  dryRun: boolean;
  outcome: TrimOutcome;
}

/**
 * Page through `query` (ordered by ageField, __name__) and hand each page's
 * docs to `handle`, which returns how many it deleted/counted. The cursor
 * survives live deletions because startAfter anchors on field values.
 */
async function forEachPage(
  query: Query,
  ageField: string,
  handle: (docs: QueryDocumentSnapshot[]) => Promise<number>
): Promise<number> {
  let total = 0;
  let last: QueryDocumentSnapshot | null = null;
  for (;;) {
    let q = query.orderBy(ageField).orderBy("__name__").limit(PAGE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    total += await handle(snap.docs);
    last = snap.docs[snap.docs.length - 1];
    if (snap.size < PAGE) break;
  }
  return total;
}

function splitByWatermark(
  docs: QueryDocumentSnapshot[],
  ageField: string,
  wm: StreamState | null,
  ctx: TrimContext
): QueryDocumentSnapshot[] {
  if (!wm) return docs;
  const deletable = docs.filter(
    (d) => !isUnexported(d.get(ageField) as Timestamp, d.id, wm)
  );
  ctx.outcome.skippedUnexported += docs.length - deletable.length;
  return deletable;
}

async function batchedDelete(
  db: Firestore,
  docs: QueryDocumentSnapshot[]
): Promise<void> {
  for (let i = 0; i < docs.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    for (const doc of docs.slice(i, i + BATCH_LIMIT)) batch.delete(doc.ref);
    await batch.commit();
  }
}

/** Jan 1 (Zurich) of `retentionYears` before `now`'s year. */
export function defaultTrimCutoff(
  now: Date,
  retentionYears = RETENTION_YEARS
): Date {
  const year = Number(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: getWorkshopTimezone(),
      year: "numeric",
    }).format(now)
  );
  return fromZonedTime(
    `${year - retentionYears}-01-01T00:00:00`,
    getWorkshopTimezone()
  );
}

export async function trimBefore(
  cutoffDate: Date,
  deps: { db: Firestore },
  opts: { dryRun?: boolean } = {}
): Promise<TrimOutcome> {
  const db = deps.db;
  const cutoff = Timestamp.fromDate(cutoffDate);
  const ctx: TrimContext = {
    db,
    dryRun: opts.dryRun ?? false,
    outcome: {
      cutoff: cutoffDate.toISOString(),
      dryRun: opts.dryRun ?? false,
      counts: {},
      skippedUnexported: 0,
      skippedPendingRenewal: 0,
      archivedPdfs: 0,
    },
  };

  // checkouts — composite index (status, closedAt); recursiveDelete for items.
  const wmVisits = await getStreamState(db, "visits");
  ctx.outcome.counts["checkouts"] = await forEachPage(
    db.collection("checkouts").where("status", "==", "closed").where("closedAt", "<", cutoff),
    "closedAt",
    async (docs) => {
      const deletable = splitByWatermark(docs, "closedAt", wmVisits, ctx);
      if (!ctx.dryRun) {
        for (const doc of deletable) await db.recursiveDelete(doc.ref);
      }
      return deletable.length;
    }
  );

  // usage_machine
  const wmUsage = await getStreamState(db, "machine_usage");
  ctx.outcome.counts["usage_machine"] = await forEachPage(
    db.collection("usage_machine").where("endTime", "<", cutoff),
    "endTime",
    async (docs) => {
      const deletable = splitByWatermark(docs, "endTime", wmUsage, ctx);
      if (!ctx.dryRun) await batchedDelete(db, deletable);
      return deletable.length;
    }
  );

  // bills — paidAt basis plus created-basis for never-paid bills, PDF
  // escrow move, pendingRenewalBill guard.
  const wmBills = await getStreamState(db, "bills");
  const pendingBillIds = new Set<string>(
    (
      await db
        .collection("memberships")
        .where("pendingRenewalBill", "!=", null)
        .get()
    ).docs
      .map((d) => (d.get("pendingRenewalBill") as { id?: string } | null)?.id)
      .filter((id): id is string => !!id)
  );
  const handleBillPage = async (
    docs: QueryDocumentSnapshot[]
  ): Promise<number> => {
    let deletable = docs.filter((d) => {
      if (pendingBillIds.has(d.id)) {
        ctx.outcome.skippedPendingRenewal++;
        return false;
      }
      return true;
    });
    deletable = deletable.filter((d) => {
      const skip = isUnexported((d.data() as BillEntity).paidAt, d.id, wmBills);
      if (skip) ctx.outcome.skippedUnexported++;
      return !skip;
    });
    if (!ctx.dryRun) {
      for (const doc of deletable) {
        const bill = doc.data() as BillEntity;
        if (bill.storagePath) {
          await moveInvoicePdfToArchive(
            bill.storagePath,
            (bill.paidAt ?? bill.created).toDate()
          );
          ctx.outcome.archivedPdfs++;
        }
      }
      await batchedDelete(db, deletable);
    } else {
      ctx.outcome.archivedPdfs += deletable.filter(
        (d) => (d.data() as BillEntity).storagePath
      ).length;
    }
    return deletable.length;
  };
  ctx.outcome.counts["bills"] =
    (await forEachPage(
      db.collection("bills").where("paidAt", "<", cutoff),
      "paidAt",
      handleBillPage
    )) +
    // Unpaid stragglers age on `created` — composite index (paidAt, created).
    (await forEachPage(
      db.collection("bills").where("paidAt", "==", null).where("created", "<", cutoff),
      "created",
      handleBillPage
    ));

  // authentications — completed records (in-progress ones die via TTL).
  ctx.outcome.counts["authentications"] = await forEachPage(
    db.collection("authentications").where("created", "<", cutoff),
    "created",
    async (docs) => {
      if (!ctx.dryRun) await batchedDelete(db, docs);
      return docs.length;
    }
  );

  // audit_log + operations_log
  for (const collection of ["audit_log", "operations_log"]) {
    ctx.outcome.counts[collection] = await forEachPage(
      db.collection(collection).where("timestamp", "<", cutoff),
      "timestamp",
      async (docs) => {
        if (!ctx.dryRun) await batchedDelete(db, docs);
        return docs.length;
      }
    );
  }

  logger.info("privacy trim", ctx.outcome);
  return ctx.outcome;
}

/**
 * `authCall/privacyTrim` — admin-only, always start with dryRun:true and
 * review the counts (see docs/data-protection.md ops calendar).
 */
export async function privacyTrimHandler(
  request: CallableRequest<{ cutoffYear?: number; dryRun?: boolean }>
): Promise<TrimOutcome> {
  if (request.auth?.token?.admin !== true) {
    throw new HttpsError("permission-denied", "Admin access required");
  }
  const { cutoffYear, dryRun } = request.data ?? {};
  const cutoff = cutoffYear
    ? fromZonedTime(`${cutoffYear}-01-01T00:00:00`, getWorkshopTimezone())
    : defaultTrimCutoff(new Date());
  const outcome = await trimBefore(cutoff, { db: getFirestore() }, { dryRun });
  await logOperationInfo(
    "erasures",
    "trim",
    "privacy_trim",
    `by ${request.auth.uid}: cutoff=${outcome.cutoff} dryRun=${outcome.dryRun} ` +
      JSON.stringify(outcome.counts)
  );
  return outcome;
}
