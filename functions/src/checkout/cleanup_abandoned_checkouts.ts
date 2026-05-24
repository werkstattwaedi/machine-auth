// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Scheduled cleanup of expired anonymous Firebase Auth users and the
 * abandoned `checkouts` docs they created (issues #151, #318).
 *
 * Eager anonymous sign-in (#151) means every visitor that gets past
 * step 1 of the checkout wizard creates a Firebase Anonymous Auth
 * principal and, lazily, a null-userId `checkouts/{id}` doc. Visitors
 * who close the tab before submitting leave both behind. The Cleanup
 * Pact (#318) reaps them together:
 *
 *   1. Anonymous Firebase Auth user whose `metadata.lastSignInTime` is
 *      older than ANON_USER_RETENTION_HOURS expires.
 *   2. For each expired user, any checkout doc stamped with
 *      `anonymousUid == <expiredUid>` is `recursiveDelete`d (the doc
 *      and its `items` subcollection).
 *   3. The expired anon Firebase Auth user is then `deleteUser`d.
 *
 * Signed-in / tag-tap checkouts are NEVER touched by this job; they
 * are scoped via the `anonymousUid == null` invariant set at create
 * time in the wizard's lazy-create path, the wizard's persistPersons
 * path, and the server's createAnonymousCheckout path. The previous
 * 24h time-based reaper that also nuked signed-in carts (the bug this
 * issue addresses) is gone.
 *
 * Run cadence is daily; the cap is one batch of users per run so a
 * runaway anon-signup spike cannot OOM the function. A two-day reap
 * lag in pathological cases is acceptable for a 7-day SLA.
 */

import * as logger from "firebase-functions/logger";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth, UserRecord } from "firebase-admin/auth";

/**
 * Anon Firebase Auth users idle for longer than this expire and have
 * their abandoned checkouts (if any) reaped. 7 days matches the
 * direction in issue #318.
 */
export const ANON_USER_RETENTION_HOURS = 7 * 24;

/** Page size for the Auth listing scan. */
const AUTH_LIST_PAGE_SIZE = 1000;

/** Cap how many expired users we successfully delete per run. */
const USER_BATCH_LIMIT = 500;

/** True iff the auth user was created via anonymous sign-in. */
function isAnonymousUser(user: UserRecord): boolean {
  // Anonymous sign-ins have no provider entries. A real user (email/
  // password, Google, custom token) has at least one provider record.
  return user.providerData.length === 0;
}

/**
 * Parse `metadata.lastSignInTime` (RFC 1123 string) into a millis
 * epoch. Returns null when the field is missing or unparsable — the
 * caller treats that as "do not delete" (safer default).
 */
function lastSignInMs(user: UserRecord): number | null {
  const raw = user.metadata.lastSignInTime;
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Delete every checkout stamped with the supplied anonymous Firebase
 * Auth UID. Returns the deleted checkout doc IDs (used for log/test
 * assertions).
 *
 * `anonymousUid` is set at create time in all three anon-create paths
 * (wizard lazy-create, persistPersons, createAnonymousCheckout) and is
 * not writable thereafter (security rules block updates that affect
 * `anonymousUid`), so the join is reliable.
 */
async function deleteCheckoutsForAnonymousUid(
  uid: string,
): Promise<string[]> {
  const db = getFirestore();
  const snap = await db
    .collection("checkouts")
    .where("anonymousUid", "==", uid)
    .get();
  if (snap.empty) return [];
  const deletedIds: string[] = [];
  for (const doc of snap.docs) {
    await db.recursiveDelete(doc.ref);
    deletedIds.push(doc.id);
  }
  return deletedIds;
}

/**
 * Core loop, exported so the integration test can invoke it directly
 * against the Firestore + Auth emulators. Returns counts and a sample
 * of the deleted UIDs / checkout IDs for assertions and log
 * observability.
 */
export async function runCleanupAbandonedCheckouts(
  now: Date = new Date(),
): Promise<{
  scannedUsers: number;
  anonymousUsers: number;
  expiredUsers: number;
  deletedUsers: number;
  deletedCheckoutCount: number;
  deletedCheckoutIds: string[];
}> {
  const cutoffMs = now.getTime() - ANON_USER_RETENTION_HOURS * 60 * 60 * 1000;
  const auth = getAuth();

  let scannedUsers = 0;
  let anonymousUsers = 0;
  let expiredUsers = 0;
  let deletedUsers = 0;
  const deletedCheckoutIds: string[] = [];

  let pageToken: string | undefined = undefined;
  outer: do {
    const page = await auth.listUsers(AUTH_LIST_PAGE_SIZE, pageToken);
    for (const user of page.users) {
      scannedUsers += 1;
      if (!isAnonymousUser(user)) continue;
      anonymousUsers += 1;
      const last = lastSignInMs(user);
      // Missing `lastSignInTime` → safer to keep; Firebase normally
      // populates this on every successful sign-in.
      if (last === null) continue;
      if (last >= cutoffMs) continue;
      expiredUsers += 1;

      // Reap checkouts first so a partial failure leaves the (now
      // unreferenced) auth user around for the next run — which will
      // re-discover it and retry. The opposite ordering would orphan
      // checkouts with no anon user to ever re-discover them.
      const ids = await deleteCheckoutsForAnonymousUid(user.uid);
      deletedCheckoutIds.push(...ids);

      try {
        await auth.deleteUser(user.uid);
        deletedUsers += 1;
      } catch (err) {
        logger.warn("Failed to delete expired anonymous user", {
          uid: user.uid,
          err: (err as Error).message,
        });
      }

      if (deletedUsers >= USER_BATCH_LIMIT) break outer;
    }
    pageToken = page.pageToken;
  } while (pageToken);

  logger.info("Cleaned up abandoned anonymous checkouts", {
    scannedUsers,
    anonymousUsers,
    expiredUsers,
    deletedUsers,
    deletedCheckoutCount: deletedCheckoutIds.length,
    olderThanHours: ANON_USER_RETENTION_HOURS,
    // Doc IDs only — no PII (anon checkouts have no name/billing).
    sampleCheckoutIds: deletedCheckoutIds.slice(0, 10),
  });

  return {
    scannedUsers,
    anonymousUsers,
    expiredUsers,
    deletedUsers,
    deletedCheckoutCount: deletedCheckoutIds.length,
    deletedCheckoutIds,
  };
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
