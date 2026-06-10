// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * checkAccountExists — does a *completed* account exist for this email?
 *
 * Drives the Galaxus-style combined login: on email submit the client asks
 * this before sending a code, so it can branch into sign-in (code only) vs
 * sign-up (name + member type + terms). "Completed" means a `users` doc whose
 * `termsAcceptedAt` is set — a bare Firebase Auth user (auto-created by a prior
 * abandoned code request) is NOT a completed account and must still be able to
 * finish sign-up.
 *
 * This intentionally reveals whether an email is registered (mirrors Galaxus).
 * The origin allow-list is enforced as in `requestLoginCode`, and the very next
 * step (requestLoginCode) is rate-limited per email, which bounds UI-driven
 * enumeration.
 */

import {
  HttpsError,
  type CallableRequest,
} from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import {
  isAllowedOrigin,
  isPlausibleEmail,
  normalizeEmail,
} from "./login-code/helpers";

export interface CheckAccountExistsInput {
  email: string;
}

export interface CheckAccountExistsResult {
  /** A completed account (user doc with accepted terms) exists. */
  exists: boolean;
  /** A Firebase Auth user exists for the email (may be an incomplete signup). */
  hasAuthUser: boolean;
}

export async function handleCheckAccountExists(
  input: CheckAccountExistsInput,
  requestOrigin: string | undefined | null
): Promise<CheckAccountExistsResult> {
  if (!input?.email || typeof input.email !== "string") {
    throw new HttpsError("invalid-argument", "email is required");
  }
  const email = normalizeEmail(input.email);
  if (!isPlausibleEmail(email)) {
    throw new HttpsError("invalid-argument", "invalid email");
  }
  if (!isAllowedOrigin(requestOrigin)) {
    throw new HttpsError("failed-precondition", "unknown request origin");
  }

  const db = getFirestore();
  const snap = await db
    .collection("users")
    .where("email", "==", email)
    .limit(1)
    .get();
  const exists = !snap.empty && snap.docs[0].get("termsAcceptedAt") != null;

  let hasAuthUser = !snap.empty;
  if (!hasAuthUser) {
    try {
      await getAuth().getUserByEmail(email);
      hasAuthUser = true;
    } catch (err: unknown) {
      const code = (err as { code?: string } | null)?.code;
      if (code !== "auth/user-not-found") throw err;
    }
  }

  return { exists, hasAuthUser };
}

export const checkAccountExistsHandler = async (
  request: CallableRequest<CheckAccountExistsInput>
) => {
  const origin =
    (request.rawRequest.headers.origin as string | undefined) ?? null;
  return handleCheckAccountExists(request.data, origin);
};
