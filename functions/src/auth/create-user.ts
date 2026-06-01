// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Callable Cloud Function: create a new user (Auth + Firestore) atomically.
 *
 * Requires the caller to have the `admin` custom claim.
 * Creates a Firebase Auth user (email-link auth, no password) and a
 * Firestore doc at `users/{authUid}` with default roles/permissions.
 */

import * as logger from "firebase-functions/logger";
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { formatFullName } from "../util/username-utils";

interface CreateUserData {
  email: string;
  firstName?: string;
  lastName?: string;
}

export const createUserHandler = async (request: CallableRequest<unknown>) => {
  // Require admin custom claim
  if (!request.auth?.token?.admin) {
    throw new HttpsError("permission-denied", "Admin access required");
  }

  const { email, firstName, lastName } = request.data as CreateUserData;

  if (!email) {
    throw new HttpsError(
      "invalid-argument",
      "email is required"
    );
  }

  const auth = getAuth();
  const db = getFirestore();
  let authUser;

  try {
    // Create Firebase Auth user (no password — email-link auth).
    // We still pass `firstName lastName` as the Firebase Auth `displayName`
    // so the Firebase Console / Auth emulator UI show recognizable names.
    const fullName = formatFullName({ firstName, lastName }, email);
    authUser = await auth.createUser({
      email,
      displayName: fullName,
    });
  } catch (error: any) {
    logger.error("Failed to create Auth user", error);
    if (error.code === "auth/email-already-exists") {
      throw new HttpsError("already-exists", "Email already in use");
    }
    throw new HttpsError("internal", `Auth user creation failed: ${error.message}`);
  }

  try {
    // Create Firestore doc with Auth UID as doc ID
    await db.collection("users").doc(authUser.uid).set({
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
    // Rollback: delete Auth user if Firestore write fails
    logger.error("Firestore write failed, rolling back Auth user", error);
    await auth.deleteUser(authUser.uid).catch((rollbackErr) => {
      logger.error("Rollback failed: could not delete Auth user", rollbackErr);
    });
    throw new HttpsError("internal", `User creation failed: ${error.message}`);
  }

  logger.info(`Created user ${authUser.uid} (${email})`);

  return { uid: authUser.uid };
};
