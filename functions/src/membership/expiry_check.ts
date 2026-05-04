// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Scheduled job: flag memberships past `validUntil` as `expired` and clear
 * `activeMembership` on their members. The pricing path includes a runtime
 * `validUntil > now` re-check on the server, so this job exists primarily
 * to keep the denormalized state honest and to drive future renewal-reminder
 * emails (TODO: send reminders N days before validUntil).
 *
 * Scheduled hourly. Idempotent — only flips memberships whose status is
 * still `active`.
 */

import * as logger from "firebase-functions/logger";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import type { MembershipEntity } from "../types/firestore_entities";

export const hourlyMembershipExpiryCheck = onSchedule(
  // Lag tolerance is governed by the runtime `validUntil > now` guard in
  // pricing — this job exists to keep denormalized state honest and (later)
  // drive renewal-reminder emails. Hourly is cheap and keeps the lag short.
  "every 60 minutes",
  async () => {
    const db = getFirestore();
    const now = Timestamp.now();
    const snap = await db
      .collection("memberships")
      .where("status", "==", "active")
      .where("validUntil", "<", now)
      .get();

    if (snap.empty) {
      logger.info("No memberships to expire");
      return;
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
  },
);
