// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Callable: family owner creates a managed (login-less) member.
 *
 * A managed member is a Firebase Auth user with NO sign-in credentials
 * (no email, no password) plus a Firestore `users/{uid}` doc with
 * `email: null` and the chosen `userType` ("erwachsen" or "kind"). They are
 * added to the family `members[]` so they get the member discount when a
 * parent picks them in the checkout roster.
 *
 * Per ADR-0029 these login-less accounts are exactly the members that can be
 * rostered onto someone else's checkout — kids, or adults who can't check in
 * on their own. The owner can later promote the account by adding an email.
 *
 * Why a real Auth UID rather than a synthetic ID: keeps the system-wide
 * invariant that `users.{uid}.id == auth.uid`, and lets us promote the
 * account later (set an email) without remapping references everywhere.
 */

import * as logger from "firebase-functions/logger";
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { getAuth } from "firebase-admin/auth";
import {
  FieldValue,
  Timestamp,
  type DocumentReference,
} from "firebase-admin/firestore";
import type { UserEntity } from "../types/firestore_entities";
import {
  assertOwnerOrAdmin,
  callerUserRef,
  db,
  getMembershipInTx,
  membershipRef,
} from "./shared";
import { formatFullName } from "../util/username-utils";

/** Managed members are login-less; firma always needs a real account/login. */
type ManagedMemberType = "erwachsen" | "kind";

interface CreateManagedMemberRequest {
  membershipId: string;
  firstName: string;
  lastName: string;
  userType: ManagedMemberType;
}

interface CreateManagedMemberResponse {
  uid: string;
}

export const createManagedMemberHandler = async (
  request: CallableRequest<CreateManagedMemberRequest>,
): Promise<CreateManagedMemberResponse> => {
  const { membershipId, firstName, lastName, userType } =
    request.data ?? ({} as CreateManagedMemberRequest);
  if (!membershipId) {
    throw new HttpsError("invalid-argument", "membershipId is required");
  }
  if (!firstName || !lastName) {
    throw new HttpsError(
      "invalid-argument",
      "firstName and lastName are required",
    );
  }
  if (userType !== "erwachsen" && userType !== "kind") {
    throw new HttpsError(
      "invalid-argument",
      "userType must be 'erwachsen' or 'kind'",
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

  // Eligibility check OUTSIDE the auth/Firestore writes — we don't want to
  // create an Auth user just to roll it back if the membership is wrong.
  const preCheckSnap = await memRef.get();
  if (!preCheckSnap.exists) {
    throw new HttpsError("not-found", "Membership not found");
  }
  // Re-using the in-tx assertion against a fresh snapshot — the txn below
  // is the authoritative check; this just gives a fast/cheap fail.
  const preMembership = preCheckSnap.data() as ReturnType<
    typeof preCheckSnap.data
  >;
  if (
    !isAdmin &&
    (preMembership?.ownerUserId as DocumentReference | undefined)?.id !==
      callerRef.id
  ) {
    throw new HttpsError("permission-denied", "Not the membership owner");
  }
  if (preMembership?.type !== "family") {
    throw new HttpsError(
      "failed-precondition",
      "Managed members can only be added to family memberships",
    );
  }

  const auth = getAuth();
  // Pass the full name as the Firebase Auth displayName so the Auth Console
  // shows a recognizable name. Kids get a " (Kind)" suffix to disambiguate.
  const fallback = userType === "kind" ? `${firstName} (Kind)` : firstName;
  const displayName = formatFullName({ firstName, lastName }, fallback);

  // Auth user with no credentials. Firebase Auth allows this — the user
  // simply has no sign-in method until someone sets an email later.
  let authUser: Awaited<ReturnType<typeof auth.createUser>>;
  try {
    authUser = await auth.createUser({
      displayName,
      // Disable until an email is set — defense-in-depth in case any sign-in
      // path is ever wired up before an email is provided.
      disabled: true,
    });
  } catch (err: unknown) {
    logger.error("Failed to create Auth user for managed member", err);
    throw new HttpsError(
      "internal",
      `Auth user creation failed: ${(err as Error).message}`,
    );
  }

  try {
    const memberRef = database.collection("users").doc(authUser.uid);
    await database.runTransaction(async (tx) => {
      const membership = await getMembershipInTx(tx, memRef);
      assertOwnerOrAdmin(membership, callerRef, isAdmin);
      if (membership.type !== "family") {
        throw new HttpsError(
          "failed-precondition",
          "Managed members can only be added to family memberships",
        );
      }
      if (membership.status !== "active") {
        throw new HttpsError(
          "failed-precondition",
          "Membership is not active",
        );
      }

      const now = Timestamp.now();
      const memberDoc: UserEntity = {
        created: now,
        firstName,
        lastName,
        email: null,
        permissions: [],
        roles: [],
        termsAcceptedAt: null,
        userType,
        billingAddress: null,
        // The membership trigger will write this; eager-set is fine too.
        activeMembership: memRef,
      };
      tx.set(memberRef, memberDoc);
      tx.update(memRef, {
        members: FieldValue.arrayUnion(memberRef),
        modifiedAt: FieldValue.serverTimestamp(),
      });
    });
  } catch (err) {
    // Rollback the Auth user if the Firestore write failed.
    logger.error(
      "Firestore write failed for managed member; rolling back Auth user",
      err,
    );
    await auth.deleteUser(authUser.uid).catch((rollbackErr) => {
      logger.error("Rollback failed: could not delete Auth user", rollbackErr);
    });
    if (err instanceof HttpsError) throw err;
    throw new HttpsError(
      "internal",
      `Managed member creation failed: ${(err as Error).message}`,
    );
  }

  logger.info("Created managed member", {
    membershipId,
    memberUid: authUser.uid,
    userType,
    callerId: callerRef.id,
  });

  return { uid: authUser.uid };
};
