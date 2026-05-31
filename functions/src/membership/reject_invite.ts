// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Callable: invitee declines a pending family-membership invite.
 */

import * as logger from "firebase-functions/logger";
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { Timestamp, type DocumentReference } from "firebase-admin/firestore";
import type { MembershipInviteEntity } from "../types/firestore_entities";
import { callerUserRef, db, membershipRef } from "./shared";

interface RejectFamilyInviteRequest {
  membershipId: string;
  inviteId: string;
}

export const rejectFamilyInviteHandler = async (request: CallableRequest<RejectFamilyInviteRequest>) => {
  const { membershipId, inviteId } = request.data ?? ({} as RejectFamilyInviteRequest);
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

  await database.runTransaction(async (tx) => {
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
    tx.update(inviteRef, {
      status: "rejected",
      resolvedAt: Timestamp.now(),
      resolvedUserId: callerRef as DocumentReference,
    });
  });

  logger.info("Rejected family invite", {
    membershipId,
    inviteId,
    userId: callerRef.id,
  });

  return { ok: true };
};
