// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Scheduled cleanup of abandoned `checkouts` docs (issue #151).
 *
 * Eager anonymous sign-in (also part of #151) means every visitor that
 * gets past step 1 of the checkout wizard creates a Firestore checkout
 * doc. Visitors who close the tab before submitting leave behind an
 * "open" checkout that nothing else garbage-collects (the bill creation
 * trigger only fires on close → bill, never on abandon).
 *
 * This function runs every 24 h and deletes every checkout doc — and
 * its `items` subcollection — that has been `status == "open"` for more
 * than `ABANDONED_AGE_HOURS` hours. Both anonymous (`userId == null`)
 * and authenticated (`userId == <ref>`) abandoned checkouts get the
 * same treatment; the owner can always start a new one.
 */

import * as logger from "firebase-functions/logger";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

/** Checkouts older than this in `status == "open"` are deleted. */
export const ABANDONED_AGE_HOURS = 24;

/** Cap how many docs we touch per run so a runaway backlog can't OOM. */
const BATCH_LIMIT = 500;

/**
 * Core loop, exported so the integration test can invoke it directly
 * against the Firestore emulator (no scheduler / functions runtime
 * needed). Returns the number of checkouts deleted.
 */
export async function runCleanupAbandonedCheckouts(
  now: Date = new Date(),
): Promise<{ deletedCount: number; deletedIds: string[] }> {
  const db = getFirestore();
  const cutoffMs = now.getTime() - ABANDONED_AGE_HOURS * 60 * 60 * 1000;
  const cutoff = Timestamp.fromMillis(cutoffMs);

  // Query open checkouts created before the cutoff. We rely on the
  // `created` field (set on doc creation in both the wizard's lazy-create
  // path and the callable's createAnonymousCheckout path). We do NOT key
  // on `modifiedAt` — anything created < 24 h ago is still considered
  // "in flight" even if its modifiedAt drifted forward when the user
  // edited an item; this trades a slightly longer reap window for not
  // having to special-case actively-edited carts.
  const snap = await db
    .collection("checkouts")
    .where("status", "==", "open")
    .where("created", "<", cutoff)
    .limit(BATCH_LIMIT)
    .get();

  if (snap.empty) {
    return { deletedCount: 0, deletedIds: [] };
  }

  const deletedIds: string[] = [];

  for (const doc of snap.docs) {
    // Recursively delete the items subcollection, then the doc itself.
    // `recursiveDelete` is the admin SDK's batched recursive deleter; it
    // handles paginating large subcollections internally.
    await db.recursiveDelete(doc.ref);
    deletedIds.push(doc.id);
  }

  logger.info("Cleaned up abandoned checkouts", {
    deletedCount: deletedIds.length,
    olderThanHours: ABANDONED_AGE_HOURS,
    // Doc IDs only — no PII (persons / billing info goes with the doc)
    sampleIds: deletedIds.slice(0, 10),
  });

  return { deletedCount: deletedIds.length, deletedIds };
}

/**
 * Scheduled trigger. Runs every 24 hours in `europe-west6` (same region
 * as the rest of the deployment) so the cron tick happens during Swiss
 * business hours.
 */
export const cleanupAbandonedCheckouts = onSchedule(
  {
    schedule: "every 24 hours",
    region: "europe-west6",
    timeoutSeconds: 540,
  },
  async () => {
    await runCleanupAbandonedCheckouts();
  },
);
