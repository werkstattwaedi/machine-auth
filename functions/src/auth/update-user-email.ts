// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Callable: change a member's login e-mail — Auth and the users doc
 * together (ADR-0043, issue #633).
 *
 * The e-mail is the login lookup key, so it is the one profile field the
 * admin UI must not write to Firestore directly: a doc-only edit used to
 * leave Auth on the old address, and the next code sign-in with the new
 * one minted a second, doc-less uid. Auth moves first so a conflict aborts
 * before the doc changes. Setting an e-mail on a managed member is what
 * promotes them to a login account (`ensureAuthIdentity` enables the
 * record).
 */

import * as logger from "firebase-functions/logger";
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { isPlausibleEmail } from "./login-code/helpers";
import {
  defaultIdentityDeps,
  ensureAuthIdentity,
  findUserDocByEmail,
  identityFromUserDoc,
  normalizeEmail,
} from "./identity";

interface UpdateUserEmailData {
  uid: string;
  email: string;
}

const EMAIL_IN_USE = "E-Mail wird bereits von einem anderen Konto verwendet.";

export const updateUserEmailHandler = async (
  request: CallableRequest<unknown>
) => {
  if (!request.auth?.token?.admin) {
    throw new HttpsError("permission-denied", "Admin access required");
  }

  const { uid, email: rawEmail } = (request.data ?? {}) as UpdateUserEmailData;
  if (!uid || typeof uid !== "string") {
    throw new HttpsError("invalid-argument", "uid is required");
  }
  // Removing a login e-mail is not a supported operation: it would strand
  // the Auth record on an address the doc no longer names.
  if (!rawEmail || typeof rawEmail !== "string") {
    throw new HttpsError("invalid-argument", "email is required");
  }
  const email = normalizeEmail(rawEmail);
  if (!isPlausibleEmail(email)) {
    throw new HttpsError("invalid-argument", "invalid email");
  }

  const db = getFirestore();
  const userRef = db.collection("users").doc(uid);
  const userDoc = await userRef.get();
  if (!userDoc.exists) {
    throw new HttpsError("not-found", "User not found");
  }

  const holder = await findUserDocByEmail(db, email);
  if (holder && holder.id !== uid) {
    throw new HttpsError("already-exists", EMAIL_IN_USE);
  }

  const result = await ensureAuthIdentity(
    defaultIdentityDeps(),
    uid,
    identityFromUserDoc(userDoc.data(), email)
  );
  if (result === "conflict") {
    throw new HttpsError("already-exists", EMAIL_IN_USE);
  }

  await userRef.update({
    email,
    modifiedBy: request.auth.uid,
    modifiedAt: FieldValue.serverTimestamp(),
  });

  logger.info("Admin changed a member's login e-mail", {
    uid,
    by: request.auth.uid,
    auth: result,
  });
  return { uid, email };
};
