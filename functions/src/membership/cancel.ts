// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Callable: cancel a membership.
 *
 * Owner can cancel their own membership; admin can cancel any. Cancellation
 * sets `status: "cancelled"` and the onMembershipWritten trigger clears
 * `activeMembership` on every member's user doc.
 *
 * No refunds are computed here — that's a finance/staff decision out of
 * band. Cancelled memberships keep their `validUntil` for audit purposes
 * (so it's clear "the user paid for X but cancelled on Y").
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

interface CancelMembershipRequest {
  membershipId: string;
}

export const cancelMembershipHandler = async (request: CallableRequest<CancelMembershipRequest>) => {
  const { membershipId } = request.data ?? ({} as CancelMembershipRequest);
  if (!membershipId) {
    throw new HttpsError("invalid-argument", "membershipId is required");
  }

  const database = db();
  const callerRef = callerUserRef(
    database,
    request.auth?.uid,
    request.auth?.token as Record<string, unknown> | undefined,
  );
  const isAdmin = request.auth?.token?.admin === true;
  const memRef = membershipRef(database, membershipId);

  await database.runTransaction(async (tx) => {
    const membership = await getMembershipInTx(tx, memRef);
    assertOwnerOrAdmin(membership, callerRef, isAdmin);
    if (membership.status === "cancelled") {
      throw new HttpsError(
        "failed-precondition",
        "Membership is already cancelled",
      );
    }
    tx.update(memRef, {
      status: "cancelled",
      modifiedAt: FieldValue.serverTimestamp(),
      modifiedBy: callerRef.id,
    });
  });

  logger.info("Cancelled membership", {
    membershipId,
    callerId: callerRef.id,
    isAdmin,
  });

  return { ok: true };
};
