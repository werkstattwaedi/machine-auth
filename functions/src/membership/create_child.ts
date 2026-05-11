// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Callable: family owner creates a child account.
 *
 * A child account is a Firebase Auth user with NO sign-in credentials
 * (no email, no password) plus a Firestore `users/{uid}` doc with
 * `userType: "kind"` and `email: null`. The child is added to the family
 * `members[]` so they get the member discount on their own visits when a
 * parent picks them in the checkout roster.
 *
 * Why a real Auth UID rather than a synthetic ID: keeps the system-wide
 * invariant that `users.{uid}.id == auth.uid`, and lets us promote the
 * account later (set an email when the kid is old enough) without
 * remapping references everywhere.
 */

import * as logger from "firebase-functions/logger";
import { HttpsError, onCall } from "firebase-functions/v2/https";
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

interface CreateChildAccountRequest {
  membershipId: string;
  firstName: string;
  lastName: string;
}

interface CreateChildAccountResponse {
  uid: string;
}

export const createChildAccount = onCall<
  CreateChildAccountRequest,
  Promise<CreateChildAccountResponse>
>(async (request) => {
  const { membershipId, firstName, lastName } =
    request.data ?? ({} as CreateChildAccountRequest);
  if (!membershipId) {
    throw new HttpsError("invalid-argument", "membershipId is required");
  }
  if (!firstName || !lastName) {
    throw new HttpsError(
      "invalid-argument",
      "firstName and lastName are required",
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
      "Child accounts can only be added to family memberships",
    );
  }

  const auth = getAuth();
  // Pass `firstName lastName` as the Firebase Auth displayName so the
  // Auth Console shows a recognizable name.
  const fullName = formatFullName(
    { firstName, lastName },
    `${firstName} (Kind)`,
  );

  // Auth user with no credentials. Firebase Auth allows this — the user
  // simply has no sign-in method until someone sets an email later.
  let authUser: Awaited<ReturnType<typeof auth.createUser>>;
  try {
    authUser = await auth.createUser({
      displayName: fullName,
      // Disable until adult/email is set — defense-in-depth in case any
      // sign-in path is ever wired up before email is provided.
      disabled: true,
    });
  } catch (err: unknown) {
    logger.error("Failed to create Auth user for child account", err);
    throw new HttpsError(
      "internal",
      `Auth user creation failed: ${(err as Error).message}`,
    );
  }

  try {
    const childRef = database.collection("users").doc(authUser.uid);
    await database.runTransaction(async (tx) => {
      const membership = await getMembershipInTx(tx, memRef);
      assertOwnerOrAdmin(membership, callerRef, isAdmin);
      if (membership.type !== "family") {
        throw new HttpsError(
          "failed-precondition",
          "Child accounts can only be added to family memberships",
        );
      }
      if (membership.status !== "active") {
        throw new HttpsError(
          "failed-precondition",
          "Membership is not active",
        );
      }

      const now = Timestamp.now();
      const childDoc: UserEntity = {
        created: now,
        firstName,
        lastName,
        email: null,
        permissions: [],
        roles: [],
        termsAcceptedAt: null,
        userType: "kind",
        billingAddress: null,
        // The membership trigger will write this; eager-set is fine too.
        activeMembership: memRef,
      };
      tx.set(childRef, childDoc);
      tx.update(memRef, {
        members: FieldValue.arrayUnion(childRef),
        modifiedAt: FieldValue.serverTimestamp(),
      });
    });
  } catch (err) {
    // Rollback the Auth user if the Firestore write failed.
    logger.error(
      "Firestore write failed for child account; rolling back Auth user",
      err,
    );
    await auth.deleteUser(authUser.uid).catch((rollbackErr) => {
      logger.error("Rollback failed: could not delete Auth user", rollbackErr);
    });
    if (err instanceof HttpsError) throw err;
    throw new HttpsError(
      "internal",
      `Child account creation failed: ${(err as Error).message}`,
    );
  }

  logger.info("Created child account", {
    membershipId,
    childUid: authUser.uid,
    callerId: callerRef.id,
  });

  return { uid: authUser.uid };
});
