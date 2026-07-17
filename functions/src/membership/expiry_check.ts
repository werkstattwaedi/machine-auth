// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Flag memberships past `validUntil` as `expired` and clear
 * `activeMembership` on their members. The pricing path includes a runtime
 * `validUntil > now` re-check on the server, so this check exists primarily
 * to keep the denormalized state honest and to drive future renewal-reminder
 * emails (TODO: send reminders N days before validUntil).
 *
 * Runs daily as part of `dailyMembershipMaintenance` — the runtime guard in
 * pricing bounds the denormalization lag to at most a day, which is
 * acceptable. Idempotent — only flips memberships whose status is still
 * `active`.
 */

import * as logger from "firebase-functions/logger";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import type { MembershipEntity } from "../types/firestore_entities";

/**
 * Core check, exported so tests and the daily maintenance job can invoke it
 * directly. Returns the number of memberships flipped to `expired`.
 */
export async function runMembershipExpiryCheck(
  now: Timestamp = Timestamp.now(),
): Promise<number> {
  const db = getFirestore();
  const snap = await db
    .collection("memberships")
    .where("status", "==", "active")
    .where("validUntil", "<", now)
    .get();

  if (snap.empty) {
    logger.info("No memberships to expire");
    return 0;
  }

  const batch = db.batch();
  for (const doc of snap.docs) {
    const membership = doc.data() as MembershipEntity;
    batch.update(doc.ref, { status: "expired", modifiedAt: now });
    // The onMembershipWritten trigger will fire and clear activeMembership
    // on each member. We don't double-write here — letting the trigger be
    // the single source for the user-doc denormalization avoids races
    // where our batch update and the trigger conflict.
    logger.info("Expiring membership", {
      membershipId: doc.id,
      owner: membership.ownerUserId.id,
      validUntil: membership.validUntil.toDate().toISOString(),
    });
  }
  await batch.commit();
  return snap.size;
}
