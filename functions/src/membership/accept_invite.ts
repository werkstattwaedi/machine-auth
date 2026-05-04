// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Callable: invitee accepts a pending family-membership invite.
 *
 * Single-active-membership invariant is re-checked transactionally — between
 * invite creation and accept, the user might have gained another membership.
 *
 * On success: appends invitee to `members[]`, marks invite `accepted`, and
 * lets the `onMembershipWritten` trigger denormalize `activeMembership` on
 * the user doc.
 */

import * as logger from "firebase-functions/logger";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import {
  FieldValue,
  Timestamp,
  type DocumentReference,
} from "firebase-admin/firestore";
import type { MembershipInviteEntity } from "../types/firestore_entities";
import {
  assertNoOtherActiveMembership,
  callerUserRef,
  db,
  getMembershipInTx,
  membershipRef,
} from "./shared";

interface AcceptFamilyInviteRequest {
  membershipId: string;
  inviteId: string;
}

export const acceptFamilyInvite = onCall<
  AcceptFamilyInviteRequest,
  Promise<{ ok: true }>
>(async (request) => {
  const { membershipId, inviteId } = request.data ?? ({} as AcceptFamilyInviteRequest);
  if (!membershipId || !inviteId) {
    throw new HttpsError(
      "invalid-argument",
      "membershipId and inviteId are required",
    );
  }

  const database = db();
  const callerRef = callerUserRef(
    database,
    request.auth?.uid,
    request.auth?.token as Record<string, unknown> | undefined,
  );
  const memRef = membershipRef(database, membershipId);
  const inviteRef = memRef.collection("invites").doc(inviteId);

  const callerEmail = (request.auth?.token?.email ?? "").toString().toLowerCase();
  if (!callerEmail) {
    throw new HttpsError(
      "failed-precondition",
      "Caller has no email — cannot accept email-based invite",
    );
  }

  await database.runTransaction(async (tx) => {
    const membership = await getMembershipInTx(tx, memRef);
    if (membership.type !== "family") {
      throw new HttpsError(
        "failed-precondition",
        "Only family memberships have invites",
      );
    }
    if (membership.status !== "active") {
      throw new HttpsError("failed-precondition", "Membership is not active");
    }

    const inviteSnap = await tx.get(inviteRef);
    if (!inviteSnap.exists) {
      throw new HttpsError("not-found", "Invite not found");
    }
    const invite = inviteSnap.data() as MembershipInviteEntity;
    if (invite.status !== "pending") {
      throw new HttpsError(
        "failed-precondition",
        `Invite already ${invite.status}`,
      );
    }
    if (invite.email !== callerEmail) {
      throw new HttpsError(
        "permission-denied",
        "Invite is for a different email",
      );
    }

    // Re-check the invariant in the transaction — between invite creation
    // and accept, another membership might have been assigned.
    await assertNoOtherActiveMembership(tx, callerRef, membershipId);

    if (membership.members.some((m) => m.id === callerRef.id)) {
      // Already a member — accept is a no-op but flip the invite for clarity.
      tx.update(inviteRef, {
        status: "accepted",
        resolvedAt: Timestamp.now(),
        resolvedUserId: callerRef as DocumentReference,
        ttlAt: FieldValue.delete(),
      });
      return;
    }

    tx.update(memRef, {
      members: FieldValue.arrayUnion(callerRef),
      modifiedAt: FieldValue.serverTimestamp(),
    });
    tx.update(inviteRef, {
      status: "accepted",
      resolvedAt: Timestamp.now(),
      resolvedUserId: callerRef as DocumentReference,
      // Retain accepted invites: clear the TTL so Firestore doesn't reap them.
      ttlAt: FieldValue.delete(),
    });
  });

  logger.info("Accepted family invite", {
    membershipId,
    inviteId,
    userId: callerRef.id,
  });

  return { ok: true };
});
