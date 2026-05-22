// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Sammelrechnung aggregation cron (issue #245).
 *
 * Belege — per-visit Sammelrechnung records, written by `acknowledgeBill`
 * and `autoAcknowledgeBills` when the user picks the monthly tab — accumulate
 * through the month. This job rolls each member's Belege from prior
 * months into a single `kind: "invoice"` Sammelrechnung with a Swiss
 * QR-bill PDF, then triggers the standard PDF + email path.
 *
 * Runs **daily** at 06:00 Europe/Zurich rather than once a month: the 1st
 * does the real work, the other 30 days are cheap empty-index seeks, and
 * if a 1st-of-month run crashes the 2nd picks up the misses. Self-healing
 * without a separate retry path.
 *
 * Note: aggregation is keyed on the Beleg's `kind` field, not on the
 * user's current `activeMembership`. A member who acks monthly and later
 * cancels their membership still receives their Sammelrechnung — the
 * customer-of-record commitment was the ack, not the membership status
 * at billing time.
 */

import * as logger from "firebase-functions/logger";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import {
  getFirestore,
  Timestamp,
  type DocumentReference,
} from "firebase-admin/firestore";
import type { BillEntity } from "./types";
import { allocateBill } from "./create_bill";
import { tryGeneratePdf, trySendEmail } from "./bill_triggers";
import { getWorkshopTimezone } from "../util/workshop_timezone";
import { fromZonedTime, toZonedTime } from "date-fns-tz";

const resendApiKey = defineSecret("RESEND_API_KEY");

const BATCH_LIMIT = 500;

/**
 * Start-of-current-month in the workshop's local timezone, expressed as a
 * UTC `Date`. A Beleg with `created` strictly less than this cutoff is
 * eligible for aggregation — meaning `now`'s own month is always
 * deferred to next month's run.
 */
function startOfCurrentZurichMonth(now: Date): Date {
  const tz = getWorkshopTimezone();
  const local = toZonedTime(now, tz);
  const localMonthStart = new Date(
    local.getFullYear(),
    local.getMonth(),
    1,
    0,
    0,
    0,
    0,
  );
  return fromZonedTime(localMonthStart, tz);
}

interface MonthlyBillRunSummary {
  scannedBelege: number;
  groupedUsers: number;
  invoicesCreated: number;
  invoiceIds: string[];
}

/**
 * Core loop, exported so the integration test can invoke it directly
 * against the Firestore emulator (no scheduler runtime needed).
 */
export async function runMonthlyBillRun(
  now: Date = new Date(),
): Promise<MonthlyBillRunSummary> {
  const db = getFirestore();
  const cutoff = Timestamp.fromDate(startOfCurrentZurichMonth(now));

  // The index ordering matches firestore.indexes.json:
  //   kind ASC, aggregatedIntoBillRef ASC, created ASC
  // Composite index is required — Firestore can't combine three filters
  // (two equality + one range) without it. Missing-index errors surface
  // in logs with a one-click create link.
  const snap = await db
    .collection("bills")
    .where("kind", "==", "beleg")
    .where("aggregatedIntoBillRef", "==", null)
    .where("created", "<", cutoff)
    .limit(BATCH_LIMIT)
    .get();

  if (snap.empty) {
    return { scannedBelege: 0, groupedUsers: 0, invoicesCreated: 0, invoiceIds: [] };
  }

  // Group Belege by userId.id. A Beleg without userId can never be
  // aggregated (we wouldn't know who to bill) — log and skip.
  const groups = new Map<string, Array<{ ref: DocumentReference; bill: BillEntity }>>();
  for (const doc of snap.docs) {
    const bill = doc.data() as BillEntity;
    if (!bill.userId) {
      logger.warn(`monthlyBillRun: skipping Beleg ${doc.id} with no userId`);
      continue;
    }
    const key = bill.userId.id;
    const arr = groups.get(key) ?? [];
    arr.push({ ref: doc.ref, bill });
    groups.set(key, arr);
  }

  const invoiceIds: string[] = [];

  for (const [userKey, belege] of groups.entries()) {
    const userId = belege[0].bill.userId;
    const aggregatedRef = db.collection("bills").doc();

    try {
      await db.runTransaction(async (tx) => {
        // Re-read each Beleg INSIDE the transaction. A concurrent run
        // (overlapping cron firings, manual ops repair) could have
        // already aggregated some of them — skip those.
        let amount = 0;
        const checkoutRefs: DocumentReference[] = [];
        const belegeToUpdate: DocumentReference[] = [];

        for (const { ref } of belege) {
          const fresh = await tx.get(ref);
          if (!fresh.exists) continue;
          const freshBill = fresh.data() as BillEntity;
          if ((freshBill.kind ?? "invoice") !== "beleg") continue;
          if (freshBill.aggregatedIntoBillRef) continue;
          amount += freshBill.amount;
          for (const checkoutRef of freshBill.checkouts) {
            checkoutRefs.push(checkoutRef);
          }
          belegeToUpdate.push(ref);
        }

        if (belegeToUpdate.length === 0) {
          // Lost the race; nothing to do.
          return;
        }

        await allocateBill(tx, db, {
          userId,
          checkoutRefs,
          amount,
          billRef: aggregatedRef,
          kind: "invoice",
          preAck: { source: "auto" },
        });

        for (const belegRef of belegeToUpdate) {
          tx.update(belegRef, { aggregatedIntoBillRef: aggregatedRef });
        }
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(
        `monthlyBillRun: aggregation txn failed for user ${userKey}`,
        { error: message },
      );
      continue;
    }

    // Confirm the bill actually got written (txn may have been a no-op).
    const aggregatedDoc = await aggregatedRef.get();
    if (!aggregatedDoc.exists) continue;

    invoiceIds.push(aggregatedRef.id);

    // Generate PDF + email synchronously so the cron run is deterministic.
    // `onBillCreate` will race with us on PDF generation; the existing
    // pdfGeneratedAt lock makes both paths idempotent — whichever lands
    // first wins, the other returns early.
    try {
      await tryGeneratePdf(aggregatedRef.id);
      await trySendEmail(aggregatedRef.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(
        `monthlyBillRun: PDF/email follow-through threw for bill ${aggregatedRef.id}`,
        { error: message },
      );
    }
  }

  const summary: MonthlyBillRunSummary = {
    scannedBelege: snap.size,
    groupedUsers: groups.size,
    invoicesCreated: invoiceIds.length,
    invoiceIds,
  };
  logger.info("monthlyBillRun: complete", summary);
  return summary;
}

/**
 * Scheduled trigger. Daily at 06:00 Europe/Zurich. On the 1st of each
 * month this does the heavy lifting; the other 30 days are cheap empty
 * lookups and provide crash recovery.
 */
export const monthlyBillRun = onSchedule(
  {
    schedule: "0 6 * * *",
    timeZone: "Europe/Zurich",
    region: "europe-west6",
    memory: "512MiB",
    timeoutSeconds: 540,
    secrets: [resendApiKey],
  },
  async () => {
    await runMonthlyBillRun();
  },
);
