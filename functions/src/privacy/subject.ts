// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Data-subject resolution for DSAR report + erasure (ADR-0038).
 *
 * A subject is either "registered" (users doc / Firebase Auth account —
 * doc id == Auth UID) or a "walk-in" (appears only as an email inside
 * checkout persons[] entries, membership invites, or loginCodes).
 */

import { DocumentReference, Firestore } from "firebase-admin/firestore";
import type { Auth, UserRecord } from "firebase-admin/auth";
import { HttpsError } from "firebase-functions/v2/https";

export interface SubjectInput {
  uid?: string;
  email?: string;
}

export interface Subject {
  kind: "registered" | "walk-in";
  /** users doc id == Firebase Auth UID; null for walk-ins. */
  uid: string | null;
  userRef: DocumentReference | null;
  /** Normalized lowercase; null when unknown (e.g. erasure re-run after
   *  the account is already gone). */
  email: string | null;
  authUser: UserRecord | null;
  userDocExists: boolean;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function resolveSubject(
  db: Firestore,
  auth: Auth,
  input: SubjectInput
): Promise<Subject> {
  if (input.uid) {
    const userRef = db.collection("users").doc(input.uid);
    const userDoc = await userRef.get();
    let authUser: UserRecord | null = null;
    try {
      authUser = await auth.getUser(input.uid);
    } catch {
      authUser = null;
    }
    const email =
      authUser?.email ?? (userDoc.get("email") as string | undefined) ?? null;
    return {
      kind: "registered",
      uid: input.uid,
      userRef,
      email: email ? normalizeEmail(email) : null,
      authUser,
      userDocExists: userDoc.exists,
    };
  }

  if (input.email) {
    const email = normalizeEmail(input.email);
    try {
      const authUser = await auth.getUserByEmail(email);
      return resolveSubject(db, auth, { uid: authUser.uid });
    } catch {
      // No Auth account — check for a users doc carrying this email
      // (child/managed accounts have email on the doc but not in Auth).
      const snap = await db
        .collection("users")
        .where("email", "==", email)
        .limit(2)
        .get();
      if (snap.size > 1) {
        throw new HttpsError(
          "failed-precondition",
          `Multiple users docs carry ${email} — resolve by uid instead`
        );
      }
      if (snap.size === 1) {
        return resolveSubject(db, auth, { uid: snap.docs[0].id });
      }
      return {
        kind: "walk-in",
        uid: null,
        userRef: null,
        email,
        authUser: null,
        userDocExists: false,
      };
    }
  }

  throw new HttpsError("invalid-argument", "Provide uid or email");
}
