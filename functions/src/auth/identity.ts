// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Member identity: `users/{uid}` is canonical, Firebase Auth follows it
 * (ADR-0043, issue #633).
 *
 * A member is two records that must agree — the users doc (profile, roles,
 * membership, badges) and the Auth account with the same uid (login
 * identity). Resolving a login by the Auth side alone splits a member in
 * two whenever the records drift: the Auth record was deleted, an admin
 * changed the doc e-mail, a managed member gained an e-mail. Everything
 * here resolves by the doc first and heals the Auth side to match.
 *
 * Pure functions over `IdentityDeps` so the emulator tests can call them
 * directly (Firestore triggers do not run in the functions test suite).
 *
 * Never call `getUserByEmail` / `createUser` to resolve a member elsewhere —
 * go through `resolveLoginUid` / `ensureAuthIdentity`.
 */

import { getAuth, type Auth, type UserRecord } from "firebase-admin/auth";
import {
  getFirestore,
  type DocumentData,
  type DocumentSnapshot,
  type Firestore,
  type QueryDocumentSnapshot,
} from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { HttpsError } from "firebase-functions/v2/https";
import { formatFullName } from "../util/username-utils";

export interface IdentityDeps {
  auth: Auth;
  db: Firestore;
}

export function defaultIdentityDeps(): IdentityDeps {
  return { auth: getAuth(), db: getFirestore() };
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** What the Auth record of a member must carry, derived from the users doc. */
export interface AuthIdentity {
  email: string;
  displayName: string;
  isAdmin: boolean;
}

export function identityFromUserDoc(
  data: DocumentData | undefined,
  email: string
): AuthIdentity {
  return {
    email,
    displayName: formatFullName(
      { firstName: data?.firstName, lastName: data?.lastName },
      email
    ),
    isAdmin: ((data?.roles as string[] | undefined) ?? []).includes("admin"),
  };
}

/**
 * The doc's login e-mail as Auth would store it (Auth lowercases), or null.
 * Stored values are normalized already; normalizing the read keeps a stray
 * console edit from looking like a perpetual mismatch — every "fix" of
 * which would revoke the member's sessions.
 */
function docEmail(doc: DocumentSnapshot): string | null {
  const raw = doc.get("email") as string | null | undefined;
  return raw ? normalizeEmail(raw) : null;
}

function isAuthError(err: unknown, code: string): boolean {
  return (err as { code?: string } | null)?.code === code;
}

async function getUserOrNull(
  auth: Auth,
  uid: string
): Promise<UserRecord | null> {
  try {
    return await auth.getUser(uid);
  } catch (err) {
    if (isAuthError(err, "auth/user-not-found")) return null;
    throw err;
  }
}

async function getUserByEmailOrNull(
  auth: Auth,
  email: string
): Promise<UserRecord | null> {
  try {
    return await auth.getUserByEmail(email);
  } catch (err) {
    if (isAuthError(err, "auth/user-not-found")) return null;
    throw err;
  }
}

/**
 * The one users doc carrying this (normalized) e-mail, or null. Two docs
 * sharing an e-mail is a data fault no code path can resolve — picking one
 * would log the member into an arbitrary half of themselves — so it fails
 * the same way for every caller and a human merges the docs.
 */
export async function findUserDocByEmail(
  db: Firestore,
  email: string
): Promise<QueryDocumentSnapshot | null> {
  const snap = await db
    .collection("users")
    .where("email", "==", email)
    .limit(2)
    .get();
  if (snap.size > 1) {
    logger.warn("Multiple users docs share one e-mail", {
      uids: snap.docs.map((d) => d.id),
    });
    throw new HttpsError(
      "failed-precondition",
      "Für diese E-Mail existieren mehrere Konten. Bitte melde dich bei der OWW."
    );
  }
  return snap.empty ? null : snap.docs[0];
}

/**
 * An Auth record nobody ever used as a member: the leftover of an abandoned
 * code request (`createUser({ email })`, never followed by a users doc).
 *
 * The claims term is the load-bearing one: `syncCustomClaims` stamps
 * `{ admin }` on the first write of every users doc, so a record without
 * custom claims never had one. This is the guard of a deletion path
 * (docs/disaster-recovery.md "Deletion paths") — do not loosen a term
 * without updating that register and the guard tests.
 */
export function isBareAuthRecord(user: UserRecord): boolean {
  return (
    user.providerData.length === 0 &&
    !user.phoneNumber &&
    Object.keys(user.customClaims ?? {}).length === 0 &&
    !user.uid.startsWith("tag:")
  );
}

export type ReclaimResult = "free" | "reclaimed" | "conflict";

/**
 * Make `email` available to `keepUid`. Auth enforces one account per
 * e-mail, so a bare record squatting on a member's address would block
 * every heal; it is deleted. Anything that is not provably bare — it has a
 * users doc, a provider, a phone, claims — is a conflict for a human.
 */
export async function reclaimEmailFromBareRecord(
  deps: IdentityDeps,
  email: string,
  keepUid: string
): Promise<ReclaimResult> {
  const holder = await getUserByEmailOrNull(deps.auth, email);
  if (!holder || holder.uid === keepUid) return "free";

  const holderDoc = await deps.db.collection("users").doc(holder.uid).get();
  if (holderDoc.exists || !isBareAuthRecord(holder)) return "conflict";

  await deps.auth.deleteUser(holder.uid);
  logger.warn("Reclaimed e-mail from a bare Auth record", {
    deletedUid: holder.uid,
    keepUid,
  });
  return "reclaimed";
}

export type EnsureResult = "unchanged" | "created" | "updated" | "conflict";

/**
 * Move an existing Auth record onto `email`. `disabled` is cleared only
 * when the record had no e-mail before — that is a managed member being
 * promoted (`createManagedMember` disables until an e-mail is set). Any
 * other disabled record is a manual block and stays blocked.
 */
async function moveAuthEmail(
  deps: IdentityDeps,
  user: UserRecord,
  email: string
): Promise<"updated" | "conflict"> {
  const reclaim = await reclaimEmailFromBareRecord(deps, email, user.uid);
  if (reclaim === "conflict") return "conflict";
  await deps.auth.updateUser(user.uid, {
    email,
    ...(user.email ? {} : { disabled: false }),
  });
  logger.info("Auth e-mail aligned with the users doc", {
    uid: user.uid,
    promoted: !user.email,
  });
  return "updated";
}

/**
 * Make the Auth record of `uid` exist and carry `identity.email`. Returns
 * `conflict` (never throws it) when a non-bare record holds the e-mail, so
 * each caller picks its own message.
 */
export async function ensureAuthIdentity(
  deps: IdentityDeps,
  uid: string,
  identity: AuthIdentity
): Promise<EnsureResult> {
  const user = await getUserOrNull(deps.auth, uid);
  if (user) {
    if (user.email === identity.email) return "unchanged";
    return moveAuthEmail(deps, user, identity.email);
  }

  const reclaim = await reclaimEmailFromBareRecord(deps, identity.email, uid);
  if (reclaim === "conflict") return "conflict";
  await deps.auth.createUser({
    uid,
    email: identity.email,
    displayName: identity.displayName,
  });
  // syncCustomClaims only fires on doc writes, so without this a recreated
  // admin stays locked out of the admin app until their doc next changes.
  await deps.auth.setCustomUserClaims(uid, { admin: identity.isAdmin });
  logger.warn("Recreated the missing Auth record of a users doc", { uid });
  return "created";
}

function loginConflict(uid: string, reason: string): HttpsError {
  // Client-triggerable (anyone can request a code for any address) → warn.
  logger.warn("Login blocked by an Auth e-mail conflict", { uid, reason });
  return new HttpsError(
    "failed-precondition",
    "Die Anmeldung mit dieser E-Mail ist gerade nicht möglich. Bitte melde dich bei der OWW."
  );
}

/**
 * The uid a verified login e-mail signs in as. Callers have already proven
 * control of `email` (normalized) with a code, link or invite.
 *
 *  1. A users doc with this e-mail wins; its Auth record is healed.
 *  2. Otherwise Auth-by-e-mail — but never onto a uid whose doc names a
 *     different e-mail: that Auth record is stale, the address no longer
 *     belongs to that member.
 *  3. Otherwise a genuinely new sign-up.
 */
export async function resolveLoginUid(
  deps: IdentityDeps,
  email: string
): Promise<string> {
  const userDoc = await findUserDocByEmail(deps.db, email);
  if (userDoc) {
    const result = await ensureAuthIdentity(
      deps,
      userDoc.id,
      identityFromUserDoc(userDoc.data(), email)
    );
    if (result === "conflict") throw loginConflict(userDoc.id, "doc-email-held");
    return userDoc.id;
  }

  const authUser = await getUserByEmailOrNull(deps.auth, email);
  if (authUser) {
    const ownerDoc = await deps.db.collection("users").doc(authUser.uid).get();
    const ownerEmail = docEmail(ownerDoc);
    if (!ownerEmail || ownerEmail === email) return authUser.uid;
    const healed = await moveAuthEmail(deps, authUser, ownerEmail);
    if (healed === "conflict") {
      throw loginConflict(authUser.uid, "stale-auth-email-not-movable");
    }
  }

  return (await deps.auth.createUser({ email })).uid;
}

/**
 * Body of the `users/{uid}` trigger: push the doc's e-mail to Auth and
 * unlink an Auth phone the doc no longer names (SMS login pauses until the
 * member re-verifies on /account/profile).
 *
 * Takes the uid only and re-reads the doc — trigger events can arrive late
 * or out of order, and acting on an event snapshot could revert a newer
 * e-mail or unlink a freshly verified number. Never throws on a conflict
 * and never creates a record: recreation stays with login and the audit.
 */
export async function reconcileAuthIdentity(
  deps: IdentityDeps,
  uid: string
): Promise<void> {
  const userDoc = await deps.db.collection("users").doc(uid).get();
  if (!userDoc.exists) return;

  const user = await getUserOrNull(deps.auth, uid);
  if (!user) {
    logger.warn("users doc without an Auth record", { uid });
    return;
  }

  const email = docEmail(userDoc);
  if (email && email !== user.email) {
    const result = await moveAuthEmail(deps, user, email);
    if (result === "conflict") {
      logger.warn("users doc e-mail is held by another Auth record", { uid });
    }
  }

  const phone = (userDoc.get("phone") as string | null | undefined) ?? null;
  if (user.phoneNumber && user.phoneNumber !== phone) {
    await deps.auth.updateUser(uid, { phoneNumber: null });
    logger.info("Unlinked an Auth phone users.phone no longer names", { uid });
  }
}
