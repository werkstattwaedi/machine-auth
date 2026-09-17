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
import { FieldValue } from "firebase-admin/firestore";
import { isPlausibleEmail } from "./login-code/helpers";
import {
  defaultIdentityDeps,
  ensureAuthIdentity,
  findUserDocByEmail,
  identityFromUserDoc,
  isBareAuthRecord,
  normalizeEmail,
  type IdentityDeps,
} from "./identity";

interface UpdateUserEmailData {
  uid: string;
  email: string;
}

const EMAIL_IN_USE = "E-Mail wird bereits von einem anderen Konto verwendet.";
const EMAIL_BUSY =
  "Mit dieser Adresse wurde eben erst eine Anmeldung begonnen. " +
  "Bitte versuche es in zwei Stunden erneut.";

/**
 * Why `ensureAuthIdentity` refused the address. A bare record that is merely
 * too fresh to delete (`BARE_RECORD_MIN_IDLE_MS`) frees itself up — telling
 * the admin "used by another account" would send them hunting for an
 * account that does not exist.
 */
async function conflictError(
  deps: IdentityDeps,
  email: string
): Promise<HttpsError> {
  const holder = await deps.auth.getUserByEmail(email).catch(() => null);
  if (holder && isBareAuthRecord(holder)) {
    const holderDoc = await deps.db.collection("users").doc(holder.uid).get();
    if (!holderDoc.exists) {
      return new HttpsError("failed-precondition", EMAIL_BUSY);
    }
  }
  return new HttpsError("already-exists", EMAIL_IN_USE);
}

/** The callable's logic over injectable deps (the emulator tests call this). */
export async function changeUserEmail(
  deps: IdentityDeps,
  input: { uid: string; email: string; actorUid: string }
): Promise<{ uid: string; email: string }> {
  const { uid, email, actorUid } = input;
  const userRef = deps.db.collection("users").doc(uid);
  const userDoc = await userRef.get();
  if (!userDoc.exists) {
    throw new HttpsError("not-found", "User not found");
  }

  const holder = await findUserDocByEmail(deps.db, email);
  if (holder && holder.id !== uid) {
    throw new HttpsError("already-exists", EMAIL_IN_USE);
  }

  const result = await ensureAuthIdentity(
    deps,
    uid,
    identityFromUserDoc(userDoc.data(), email)
  );
  if (result === "conflict") throw await conflictError(deps, email);

  try {
    await userRef.update({
      email,
      modifiedBy: actorUid,
      modifiedAt: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    // Auth has moved, the doc has not — and the doc is canonical. Left like
    // this, the member's next login with the NEW address finds no doc for
    // it, sees an Auth record whose doc names another address, moves Auth
    // back and mints a fresh uid: the very split this callable prevents.
    // Put Auth back now. (A managed member being promoted has no previous
    // address to return to; its Auth e-mail then logs into the right uid.)
    const previousEmail = userDoc.get("email") as string | null | undefined;
    if (previousEmail && result !== "unchanged") {
      await ensureAuthIdentity(
        deps,
        uid,
        identityFromUserDoc(userDoc.data(), normalizeEmail(previousEmail))
      ).catch((rollbackErr) => {
        logger.error("updateUserEmail: could not move Auth back", {
          uid,
          rollbackErr,
        });
      });
    }
    logger.error("updateUserEmail: users doc write failed after Auth moved", {
      uid,
      err,
    });
    throw new HttpsError("internal", "E-Mail konnte nicht gespeichert werden.");
  }

  logger.info("Admin changed a member's login e-mail", {
    uid,
    by: actorUid,
    auth: result,
  });
  return { uid, email };
}

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

  return changeUserEmail(defaultIdentityDeps(), {
    uid,
    email,
    actorUid: request.auth.uid,
  });
};
