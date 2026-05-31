// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Callable: family owner cancels a pending invite.
 */

import * as logger from "firebase-functions/logger";
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import type { MembershipInviteEntity } from "../types/firestore_entities";
import {
  assertOwnerOrAdmin,
  callerUserRef,
  db,
  getMembershipInTx,
  membershipRef,
} from "./shared";

interface RevokeFamilyInviteRequest {
  membershipId: string;
  inviteId: string;
}

export const revokeFamilyInviteHandler = async (request: CallableRequest<RevokeFamilyInviteRequest>) => {
  const { membershipId, inviteId } = request.data ?? ({} as RevokeFamilyInviteRequest);
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
  const isAdmin = request.auth?.token?.admin === true;
  const memRef = membershipRef(database, membershipId);
  const inviteRef = memRef.collection("invites").doc(inviteId);

  await database.runTransaction(async (tx) => {
    const membership = await getMembershipInTx(tx, memRef);
    assertOwnerOrAdmin(membership, callerRef, isAdmin);

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
    tx.update(inviteRef, {
      status: "revoked",
      resolvedAt: Timestamp.now(),
    });
  });

  logger.info("Revoked family invite", {
    membershipId,
    inviteId,
    callerId: callerRef.id,
  });

  return { ok: true };
};
