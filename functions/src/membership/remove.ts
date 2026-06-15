// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Callable: remove a member from a family membership.
 *
 * Authorized when the caller is the owner/admin (removing anyone) OR a member
 * removing themselves ("Familie verlassen"). The owner cannot be removed this
 * way — they use cancelMembership instead. The onMembershipWritten trigger
 * clears `activeMembership` on the removed user.
 */

import * as logger from "firebase-functions/logger";
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import {
  callerUserRef,
  db,
  getMembershipInTx,
  membershipRef,
} from "./shared";

interface RemoveFamilyMemberRequest {
  membershipId: string;
  userId: string;
}

export const removeFamilyMemberHandler = async (request: CallableRequest<RemoveFamilyMemberRequest>) => {
  const { membershipId, userId } = request.data ?? ({} as RemoveFamilyMemberRequest);
  if (!membershipId || !userId) {
    throw new HttpsError(
      "invalid-argument",
      "membershipId and userId are required",
    );
  }

  const database = db();
  const callerRef = callerUserRef(
    database,
    request.auth?.uid,
    request.auth?.token as Record<string, unknown> | undefined,
  );
  const isAdmin = request.auth?.token?.admin === true;
  const memRef = membershipRef(database, membershipId);
  const targetRef = database.collection("users").doc(userId);

  const isSelfRemoval = callerRef.id === userId;

  await database.runTransaction(async (tx) => {
    const membership = await getMembershipInTx(tx, memRef);
    // Owner/admin may remove anyone; a member may remove only themselves.
    if (!isAdmin && membership.ownerUserId.id !== callerRef.id && !isSelfRemoval) {
      throw new HttpsError(
        "permission-denied",
        "Only the owner, an admin, or the member themselves can remove a member",
      );
    }

    if (membership.type !== "family") {
      throw new HttpsError(
        "failed-precondition",
        "Only family memberships have multiple members",
      );
    }
    if (membership.ownerUserId.id === userId) {
      throw new HttpsError(
        "failed-precondition",
        "Cannot remove the membership owner — cancel the membership instead",
      );
    }
    if (!membership.members.some((m) => m.id === userId)) {
      throw new HttpsError(
        "not-found",
        "User is not a member of this family",
      );
    }

    tx.update(memRef, {
      members: FieldValue.arrayRemove(targetRef),
      modifiedAt: FieldValue.serverTimestamp(),
    });
  });

  logger.info("Removed family member", {
    membershipId,
    removedUserId: userId,
    callerId: callerRef.id,
  });

  return { ok: true };
};
