// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Firestore trigger: keep `users.activeMembership` in sync with the
 * `memberships/{id}` document.
 *
 * On every membership write we:
 *  1. compute the set of users that were added/removed/retained,
 *  2. for each user, write `activeMembership = ref` if the membership is
 *     active and they're a current member; otherwise clear to `null`,
 *  3. log if we ever observe a user already pointing at a *different*
 *     active membership (single-active-membership invariant violation).
 *
 * The callable transactional check in `shared.assertNoOtherActiveMembership`
 * is the primary defense; this trigger is the safety net.
 */

import * as logger from "firebase-functions/logger";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import {
  getFirestore,
  type DocumentReference,
} from "firebase-admin/firestore";
import type { MembershipEntity } from "../types/firestore_entities";

function refIds(refs: DocumentReference[] | undefined): Set<string> {
  return new Set((refs ?? []).map((r) => r.id));
}

export const onMembershipWritten = onDocumentWritten(
  "memberships/{membershipId}",
  async (event) => {
    const before = event.data?.before.data() as MembershipEntity | undefined;
    const after = event.data?.after.data() as MembershipEntity | undefined;
    const membershipRef = (event.data?.after.ref ??
      event.data?.before.ref) as DocumentReference | undefined;
    if (!membershipRef) return;

    const beforeIds = refIds(before?.members);
    const afterIds = refIds(after?.members);

    const allIds = new Set<string>([...beforeIds, ...afterIds]);
    const isActive =
      after !== undefined && after.status === "active";

    const db = getFirestore();
    const writes: Promise<unknown>[] = [];

    for (const userId of allIds) {
      const isMemberNow = isActive && afterIds.has(userId);
      const userRef = db.collection("users").doc(userId);

      writes.push(
        db.runTransaction(async (tx) => {
          const userSnap = await tx.get(userRef);
          if (!userSnap.exists) return;
          const current = (userSnap.data()?.activeMembership ?? null) as
            | DocumentReference
            | null;

          if (isMemberNow) {
            if (
              current !== null &&
              current.id !== membershipRef.id
            ) {
              logger.error(
                "Single-active-membership invariant violated",
                {
                  userId,
                  currentMembership: current.id,
                  newMembership: membershipRef.id,
                },
              );
            }
            if (current?.id !== membershipRef.id) {
              tx.update(userRef, { activeMembership: membershipRef });
            }
          } else {
            // User removed, or membership no longer active.
            if (current?.id === membershipRef.id) {
              tx.update(userRef, { activeMembership: null });
            }
          }
        }),
      );
    }

    await Promise.all(writes);
  },
);
