// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Callable: family owner removes a member from their family membership.
 *
 * The owner cannot remove themselves (use cancelMembership instead). The
 * onMembershipWritten trigger clears `activeMembership` on the removed
 * user.
 */

import * as logger from "firebase-functions/logger";
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import {
  assertOwnerOrAdmin,
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

  await database.runTransaction(async (tx) => {
    const membership = await getMembershipInTx(tx, memRef);
    assertOwnerOrAdmin(membership, callerRef, isAdmin);

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
