// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Callable: accept a family invite by creating a brand-new account from the
 * invite link — NO 6-digit code required.
 *
 * Rationale: the invite link carries an unguessable doc id and was delivered to
 * the invited address, so possession of the link already proves control of that
 * email — a code would prove nothing extra. This shortcut is allowed ONLY when
 * no *completed* account exists for the email yet (nothing to protect). If a
 * completed account exists, the caller is diverted to normal login by the
 * `already-exists` error (a leaked link must not pseudo-login an existing
 * account).
 *
 * On success: resolves-or-creates the Auth user for the invited email, writes
 * the user doc (name + accepted terms, userType "erwachsen"), appends them to
 * `members[]`, marks the invite accepted, and returns a custom token the client
 * swaps for a session via signInWithCustomToken().
 *
 * Origin-gated like the login callables.
 */

import * as logger from "firebase-functions/logger";
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import type {
  BillingAddress,
  MembershipInviteEntity,
  UserEntity,
} from "../types/firestore_entities";
import {
  assertNoOtherActiveMembership,
  db,
  getMembershipInTx,
  membershipRef,
} from "./shared";
import { isAllowedOrigin } from "../auth/login-code/helpers";

type SignupUserType = "erwachsen" | "kind" | "firma";

export interface AcceptInviteNewAccountRequest {
  membershipId: string;
  inviteId: string;
  firstName: string;
  lastName: string;
  userType: SignupUserType;
  termsAccepted: boolean;
  /** Required (complete) when userType === "firma"; ignored otherwise. */
  billingAddress?: BillingAddress | null;
}

function normalizeBillingAddress(
  userType: SignupUserType,
  raw: BillingAddress | null | undefined,
): BillingAddress | null {
  if (userType !== "firma") return null;
  const a = raw ?? ({} as Partial<BillingAddress>);
  const company = (a.company ?? "").trim();
  const street = (a.street ?? "").trim();
  const zip = (a.zip ?? "").trim();
  const city = (a.city ?? "").trim();
  if (!company || !street || !zip || !city) {
    throw new HttpsError(
      "invalid-argument",
      "Firma requires a complete billing address",
    );
  }
  return { company, street, zip, city };
}

export interface AcceptInviteNewAccountResult {
  customToken: string;
}

export async function handleAcceptInviteNewAccount(
  input: AcceptInviteNewAccountRequest,
  requestOrigin: string | undefined | null,
): Promise<AcceptInviteNewAccountResult> {
  const { membershipId, inviteId, firstName, lastName, userType, termsAccepted } =
    input ?? ({} as AcceptInviteNewAccountRequest);
  if (!membershipId || !inviteId) {
    throw new HttpsError(
      "invalid-argument",
      "membershipId and inviteId are required",
    );
  }
  if (!firstName?.trim() || !lastName?.trim()) {
    throw new HttpsError(
      "invalid-argument",
      "firstName and lastName are required",
    );
  }
  if (
    userType !== "erwachsen" &&
    userType !== "kind" &&
    userType !== "firma"
  ) {
    throw new HttpsError(
      "invalid-argument",
      "userType must be 'erwachsen', 'kind' or 'firma'",
    );
  }
  if (termsAccepted !== true) {
    throw new HttpsError(
      "failed-precondition",
      "Terms must be accepted",
    );
  }
  if (!isAllowedOrigin(requestOrigin)) {
    throw new HttpsError("failed-precondition", "unknown request origin");
  }
  const billingAddress = normalizeBillingAddress(userType, input.billingAddress);

  const database = db();
  const memRef = membershipRef(database, membershipId);
  const inviteRef = memRef.collection("invites").doc(inviteId);

  // Pre-transaction reads to validate the invite and resolve the email before
  // we touch Auth — avoids creating an Auth user we'd have to roll back.
  const inviteSnap = await inviteRef.get();
  if (!inviteSnap.exists) {
    throw new HttpsError("not-found", "Invite not found");
  }
  const invite = inviteSnap.data() as MembershipInviteEntity;
  if (invite.status !== "pending") {
    throw new HttpsError("failed-precondition", `Invite already ${invite.status}`);
  }
  if (invite.ttlAt != null && invite.ttlAt.toMillis() < Date.now()) {
    throw new HttpsError("failed-precondition", "Invite has expired");
  }
  const email = invite.email;

  // The no-code path is only for accounts that don't exist yet. A completed
  // account must go through normal login — surface that to the client.
  const existingUser = await database
    .collection("users")
    .where("email", "==", email)
    .limit(1)
    .get();
  if (!existingUser.empty && existingUser.docs[0].get("termsAcceptedAt") != null) {
    throw new HttpsError(
      "already-exists",
      "An account already exists for this email — sign in instead",
    );
  }

  // Resolve-or-create the Auth user for the invited email. `emailVerified` is
  // set only AFTER the transaction commits — we don't want to mark an existing
  // (incomplete) user's email verified if the accept then fails.
  const auth = getAuth();
  let uid: string;
  try {
    uid = (await auth.getUserByEmail(email)).uid;
  } catch (err: unknown) {
    const code = (err as { code?: string } | null)?.code;
    if (code !== "auth/user-not-found") throw err;
    uid = (await auth.createUser({ email })).uid;
  }

  const userDocRef = database.collection("users").doc(uid);

  try {
    await database.runTransaction(async (tx) => {
      const membership = await getMembershipInTx(tx, memRef);
      if (membership.type !== "family") {
        throw new HttpsError(
          "failed-precondition",
          "Only family memberships have invites",
        );
      }
      if (membership.status !== "active") {
        throw new HttpsError("failed-precondition", "Membership is not active");
      }

      // Re-read invite inside the txn — guard against a concurrent accept/revoke.
      const freshInviteSnap = await tx.get(inviteRef);
      if (!freshInviteSnap.exists) {
        throw new HttpsError("not-found", "Invite not found");
      }
      const freshInvite = freshInviteSnap.data() as MembershipInviteEntity;
      if (freshInvite.status !== "pending") {
        throw new HttpsError(
          "failed-precondition",
          `Invite already ${freshInvite.status}`,
        );
      }
      if (freshInvite.email !== email) {
        throw new HttpsError("permission-denied", "Invite email mismatch");
      }

      const userSnap = await tx.get(userDocRef);
      // Authoritative completed-account guard (the pre-tx query is only a fast
      // path): a leaked link must never let the no-code path overwrite/attach
      // to an account that already finished sign-up. Re-checked here to close
      // the TOCTOU window against a concurrent normal sign-up.
      if (userSnap.exists && userSnap.get("termsAcceptedAt") != null) {
        throw new HttpsError(
          "already-exists",
          "An account already exists for this email — sign in instead",
        );
      }
      // Single-active-membership invariant (only meaningful if a doc exists).
      if (userSnap.exists) {
        await assertNoOtherActiveMembership(tx, userDocRef, membershipId);
      }

      const now = Timestamp.now();
      tx.set(
        userDocRef,
        {
          email,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          userType,
          termsAcceptedAt: now,
          billingAddress,
          activeMembership: memRef,
          // New doc gets the full scaffold; an existing (incomplete) doc keeps
          // its created/roles/permissions/phone.
          ...(userSnap.exists
            ? {}
            : {
                created: now,
                roles: [],
                permissions: [],
                phone: null,
              }),
        } satisfies Partial<UserEntity> & Record<string, unknown>,
        { merge: true },
      );

      if (!membership.members.some((m) => m.id === uid)) {
        tx.update(memRef, {
          members: FieldValue.arrayUnion(userDocRef),
          modifiedAt: FieldValue.serverTimestamp(),
        });
      }
      tx.update(inviteRef, {
        status: "accepted",
        resolvedAt: now,
        resolvedUserId: userDocRef,
        ttlAt: FieldValue.delete(),
      });
    });
  } catch (err) {
    // We may have just created the Auth user. Leave it: re-running the flow
    // resolves the same uid via getUserByEmail, and a credential-less,
    // doc-less, email-UNverified Auth user is inert (we set emailVerified only
    // after a successful commit, below). Mirrors mintSessionToken, which also
    // leaves its created user in place.
    logger.error("acceptInviteNewAccount transaction failed", {
      err,
      membershipId,
      inviteId,
    });
    throw err instanceof HttpsError
      ? err
      : new HttpsError("internal", (err as Error).message);
  }

  // The invite link proved control of the address — mark it verified now that
  // the account is actually attached to the family.
  await auth.updateUser(uid, { emailVerified: true });

  const customToken = await auth.createCustomToken(uid, {
    loginMethod: "inviteLink",
  });

  logger.info("Accepted family invite via new account", {
    membershipId,
    inviteId,
    userId: uid,
  });

  return { customToken };
}

export const acceptFamilyInviteNewAccountHandler = async (
  request: CallableRequest<AcceptInviteNewAccountRequest>,
) => {
  const origin =
    (request.rawRequest.headers.origin as string | undefined) ?? null;
  return handleAcceptInviteNewAccount(request.data, origin);
};
