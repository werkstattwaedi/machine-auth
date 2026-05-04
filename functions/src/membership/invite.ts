// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Callable: family owner invites a user (by email) to join their family
 * membership. The invitee accepts/rejects via separate callables.
 *
 * Eligibility:
 *  - membership type must be `family`
 *  - caller must be the owner (or admin)
 *  - membership must be active
 *  - target user must exist (we don't auto-create from invites; family
 *    owners create child accounts via `createChildAccount` for the
 *    no-email case)
 *  - target user must not already have an active membership
 */

import * as logger from "firebase-functions/logger";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import {
  Timestamp,
  type DocumentReference,
} from "firebase-admin/firestore";
import type {
  MembershipInviteEntity,
  UserEntity,
} from "../types/firestore_entities";
import {
  assertNoOtherActiveMembership,
  assertOwnerOrAdmin,
  callerUserRef,
  db,
  findUserByEmail,
  getMembershipInTx,
  INVITE_TTL_MS,
  membershipRef,
} from "./shared";

interface InviteFamilyMemberRequest {
  membershipId: string;
  email: string;
}

interface InviteFamilyMemberResponse {
  inviteId: string;
}

export const inviteFamilyMember = onCall<
  InviteFamilyMemberRequest,
  Promise<InviteFamilyMemberResponse>
>(async (request) => {
  const { membershipId, email } = request.data ?? ({} as InviteFamilyMemberRequest);
  if (!membershipId) {
    throw new HttpsError("invalid-argument", "membershipId is required");
  }
  if (!email || typeof email !== "string") {
    throw new HttpsError("invalid-argument", "email is required");
  }
  const normalizedEmail = email.trim().toLowerCase();

  const database = db();
  const callerRef = callerUserRef(
    database,
    request.auth?.uid,
    request.auth?.token as Record<string, unknown> | undefined,
  );
  const isAdmin = request.auth?.token?.admin === true;
  const memRef = membershipRef(database, membershipId);

  // Pre-resolve the invitee outside the transaction (read-only lookup;
  // the invariant check below re-validates inside the txn so we don't race).
  const inviteeRef = await findUserByEmail(database, normalizedEmail);
  if (!inviteeRef) {
    throw new HttpsError(
      "not-found",
      `No user with email ${normalizedEmail} exists yet`,
    );
  }

  const inviteRef = memRef.collection("invites").doc();

  await database.runTransaction(async (tx) => {
    const membership = await getMembershipInTx(tx, memRef);
    assertOwnerOrAdmin(membership, callerRef, isAdmin);

    if (membership.type !== "family") {
      throw new HttpsError(
        "failed-precondition",
        "Only family memberships can have invites",
      );
    }
    if (membership.status !== "active") {
      throw new HttpsError(
        "failed-precondition",
        "Membership is not active",
      );
    }
    if (membership.members.some((m) => m.id === inviteeRef.id)) {
      throw new HttpsError(
        "already-exists",
        "User is already a member of this family",
      );
    }

    // Single-active-membership invariant — re-checked at accept time too.
    await assertNoOtherActiveMembership(tx, inviteeRef, membershipId);

    const now = Timestamp.now();
    const invite: MembershipInviteEntity = {
      email: normalizedEmail,
      status: "pending",
      invitedAt: now,
      invitedBy: callerRef as DocumentReference,
      resolvedAt: null,
      ttlAt: Timestamp.fromMillis(now.toMillis() + INVITE_TTL_MS),
    };
    tx.set(inviteRef, invite);
  });

  logger.info("Created family invite", {
    membershipId,
    inviteId: inviteRef.id,
    email: normalizedEmail,
    ownerId: callerRef.id,
  });

  return { inviteId: inviteRef.id };
});
