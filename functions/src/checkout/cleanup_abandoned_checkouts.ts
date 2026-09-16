// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Scheduled cleanup of expired throwaway Firebase Auth principals and the
 * abandoned anonymous carts they created (issues #151, #318).
 *
 * Eager anonymous sign-in (#151) means every visitor that gets past
 * step 1 of the checkout wizard creates a Firebase Anonymous Auth
 * principal and, lazily, a null-userId `checkouts/{id}` doc. Visitors
 * who close the tab before submitting leave both behind. The Cleanup
 * Pact (#318) reaps them together:
 *
 *   1. A throwaway auth principal whose `metadata.lastSignInTime` is
 *      older than ANON_USER_RETENTION_HOURS expires.
 *   2. For each expired principal, every *abandoned cart* stamped with
 *      `firebaseUid == <expiredUid>` is `recursiveDelete`d (the doc and
 *      its `items` subcollection).
 *   3. The expired auth principal is then `deleteUser`d.
 *
 * Two invariants keep this job away from anything that is a record:
 *
 *   - "Throwaway principal" means no provider data AND no e-mail AND no
 *     phone number. `providerData.length === 0` alone is NOT enough: the
 *     login-code flow creates password-less accounts (`createUser({
 *     email })` + custom token) and every kiosk badge tap mints a
 *     `tag:<userId>:<nonce>` custom-token session — both have an empty
 *     provider list. Kiosk session principals *are* reaped (they are
 *     per-visit nonces and pile up otherwise); e-mail / phone accounts
 *     never are.
 *   - "Abandoned cart" means `status == "open"` with no `userId`. A
 *     checkout that is closed, billed, or belongs to a user (kiosk
 *     visits, signed-in web checkouts) is never deleted here, whatever
 *     principal created it — bills point at it and the 3-year retention
 *     (ADR-0038) owns its lifecycle.
 *
 * Incident 2026-09: the job matched kiosk sessions as anonymous and
 * deleted every checkout they created, including closed, billed ones
 * (37 of the 75 checkouts referenced by prod bills). Both invariants
 * above are the fix; the integration test pins them.
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
 * Throwaway auth principals idle for longer than this expire and have
 * their abandoned carts (if any) reaped. 7 days per issue #318 — kept
 * deliberately shorter than the 30-day backup retention after the 2026-09
 * incident: a wrong deletion then surfaces and is restorable long before
 * its last backup expires, which a window as long as the backups would
 * not guarantee.
 */
export const ANON_USER_RETENTION_HOURS = 7 * 24;

/** Page size for the Auth listing scan. */
const AUTH_LIST_PAGE_SIZE = 1000;

/** Cap how many expired users we successfully delete per run. */
const USER_BATCH_LIMIT = 500;

/**
 * True iff the auth user is a throwaway principal nobody can sign back
 * into: no provider entries and no contact identity. Anonymous sign-ins
 * and kiosk `tag:` sessions qualify; password-less e-mail accounts from
 * the login-code flow and phone-auth accounts do not, even though their
 * provider list is empty too.
 */
export function isThrowawayPrincipal(user: UserRecord): boolean {
  return (
    user.providerData.length === 0 && !user.email && !user.phoneNumber
  );
}

/**
 * True iff the checkout is an abandoned anonymous cart: still open and
 * owned by nobody. Anything closed, billed or attached to a user is a
 * record and must survive its creating principal.
 */
export function isAbandonedCart(data: FirebaseFirestore.DocumentData): boolean {
  return data.status === "open" && data.userId == null && data.billRef == null;
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
 * Delete the abandoned carts stamped with the supplied Firebase Auth
 * UID. Returns the deleted checkout doc IDs plus the number of records
 * that were stamped by the same principal but kept (closed, billed or
 * user-owned) — surfaced in the run log so a regression is visible.
 */
async function deleteAbandonedCartsForFirebaseUid(
  uid: string,
): Promise<{ deletedIds: string[]; keptCount: number }> {
  const db = getFirestore();
  const snap = await db
    .collection("checkouts")
    .where("firebaseUid", "==", uid)
    .get();
  const deletedIds: string[] = [];
  let keptCount = 0;
  for (const doc of snap.docs) {
    if (!isAbandonedCart(doc.data())) {
      keptCount += 1;
      continue;
    }
    await db.recursiveDelete(doc.ref);
    deletedIds.push(doc.id);
  }
  return { deletedIds, keptCount };
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
  keptCheckoutCount: number;
}> {
  const cutoffMs = now.getTime() - ANON_USER_RETENTION_HOURS * 60 * 60 * 1000;
  const auth = getAuth();

  let scannedUsers = 0;
  let anonymousUsers = 0;
  let expiredUsers = 0;
  let deletedUsers = 0;
  let keptCheckoutCount = 0;
  const deletedCheckoutIds: string[] = [];

  let pageToken: string | undefined = undefined;
  outer: do {
    const page = await auth.listUsers(AUTH_LIST_PAGE_SIZE, pageToken);
    for (const user of page.users) {
      scannedUsers += 1;
      if (!isThrowawayPrincipal(user)) continue;
      anonymousUsers += 1;
      const last = lastSignInMs(user);
      // Missing `lastSignInTime` → safer to keep; Firebase normally
      // populates this on every successful sign-in.
      if (last === null) continue;
      if (last >= cutoffMs) continue;
      expiredUsers += 1;

      // Reap carts first so a partial failure leaves the (now
      // unreferenced) auth user around for the next run — which will
      // re-discover it and retry. The opposite ordering would orphan
      // carts with no principal to ever re-discover them.
      const { deletedIds, keptCount } =
        await deleteAbandonedCartsForFirebaseUid(user.uid);
      deletedCheckoutIds.push(...deletedIds);
      keptCheckoutCount += keptCount;

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
    keptCheckoutCount,
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
    keptCheckoutCount,
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
    timeoutSeconds: 540,
  },
  async () => {
    await runCleanupAbandonedCheckouts();
  },
);
