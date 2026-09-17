// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Callable Cloud Function: create a new user (Auth + Firestore) atomically.
 *
 * Requires the caller to have the `admin` custom claim.
 * Creates a Firebase Auth user (email-link auth, no password) and a
 * Firestore doc at `users/{authUid}` with default roles/permissions.
 *
 * When a *bare* Auth record already holds the e-mail (an abandoned code
 * request — see `isBareAuthRecord`), that record is adopted: the doc is
 * created under its uid, so whoever requested the code lands on the
 * admin-created profile. Adopting deletes nothing (ADR-0043).
 */

import * as logger from "firebase-functions/logger";
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { getAuth, type UserRecord } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { formatFullName } from "../util/username-utils";
import {
  findUserDocByEmail,
  isBareAuthRecord,
  normalizeEmail,
} from "./identity";

interface CreateUserData {
  email: string;
  firstName?: string;
  lastName?: string;
}

const EMAIL_IN_USE = "Email already in use";

export const createUserHandler = async (request: CallableRequest<unknown>) => {
  // Require admin custom claim
  if (!request.auth?.token?.admin) {
    throw new HttpsError("permission-denied", "Admin access required");
  }

  const { email: rawEmail, firstName, lastName } =
    request.data as CreateUserData;

  if (!rawEmail) {
    throw new HttpsError(
      "invalid-argument",
      "email is required"
    );
  }
  const email = normalizeEmail(rawEmail);

  const auth = getAuth();
  const db = getFirestore();

  // The users doc is the canonical identity: an e-mail a doc already
  // carries is taken, whatever the Auth side says.
  if (await findUserDocByEmail(db, email)) {
    throw new HttpsError("already-exists", EMAIL_IN_USE);
  }

  // We still pass `firstName lastName` as the Firebase Auth `displayName`
  // so the Firebase Console / Auth emulator UI show recognizable names.
  const fullName = formatFullName({ firstName, lastName }, email);
  let authUser: UserRecord;
  // Only a record created by THIS call may be rolled back below.
  let createdHere = true;

  try {
    // Create Firebase Auth user (no password — email-link auth).
    authUser = await auth.createUser({
      email,
      displayName: fullName,
    });
  } catch (error: any) {
    if (error.code !== "auth/email-already-exists") {
      logger.error("Failed to create Auth user", error);
      throw new HttpsError("internal", `Auth user creation failed: ${error.message}`);
    }
    const holder = await auth.getUserByEmail(email);
    const holderDoc = await db.collection("users").doc(holder.uid).get();
    if (holderDoc.exists || !isBareAuthRecord(holder)) {
      throw new HttpsError("already-exists", EMAIL_IN_USE);
    }
    authUser = await auth.updateUser(holder.uid, { displayName: fullName });
    createdHere = false;
  }

  try {
    // Create Firestore doc with Auth UID as doc ID. `create()` so a sign-up
    // finishing on the adopted uid at the same moment is never clobbered.
    await db.collection("users").doc(authUser.uid).create({
      created: Timestamp.now(),
      email,
      firstName: firstName ?? "",
      lastName: lastName ?? "",
      permissions: [],
      roles: [],
      termsAcceptedAt: null,
      userType: "erwachsen",
      billingAddress: null,
    });
  } catch (error: any) {
    // ALREADY_EXISTS: a sign-up finished on the adopted uid while we were
    // here. Anyone requesting a code at the right moment can cause that, so
    // it is a warning, not a fault — and nothing of ours to roll back.
    if (error.code === 6 /* ALREADY_EXISTS */) {
      logger.warn("createUser: users doc appeared concurrently", {
        uid: authUser.uid,
      });
      throw new HttpsError("already-exists", EMAIL_IN_USE);
    }
    logger.error("Firestore write failed for new user", error);
    if (createdHere) {
      // Rollback: delete the Auth user this call created.
      await auth.deleteUser(authUser.uid).catch((rollbackErr) => {
        logger.error("Rollback failed: could not delete Auth user", rollbackErr);
      });
    }
    throw new HttpsError("internal", `User creation failed: ${error.message}`);
  }

  logger.info(`Created user ${authUser.uid} (${email})`, {
    adopted: !createdHere,
  });

  return { uid: authUser.uid };
};
