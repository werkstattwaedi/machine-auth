// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Callable: family owner invites a user (by email) to join their family
 * membership. The invitee accepts/rejects via separate callables.
 *
 * Eligibility:
 *  - membership type must be `family`
 *  - caller must be the owner (or admin)
 *  - membership must be active
 *  - target user does NOT need to exist yet — first sign-in will create
 *    both the Firebase Auth user (mintSessionToken) and the Firestore
 *    user doc (handleSignIn on the web client). The single-active-
 *    membership invariant is re-verified transactionally at accept time.
 */

import * as logger from "firebase-functions/logger";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import {
  Timestamp,
  type DocumentReference,
} from "firebase-admin/firestore";
import type {
  MembershipInviteEntity,
  UserEntity,
} from "../types/firestore_entities";
import {
  assertNoOtherActiveMembership,
  assertOwnerOrAdmin,
  callerUserRef,
  db,
  findUserByEmail,
  getMembershipInTx,
  INVITE_TTL_MS,
  membershipRef,
} from "./shared";
import { isAllowedOrigin, isEmulator } from "../auth/login-code/helpers";
import {
  resendApiKey,
  sendTemplate,
} from "../util/resend_template";
import { formatFullName } from "../util/username-utils";
import { defineString } from "firebase-functions/params";

export interface InviteFamilyMemberRequest {
  membershipId: string;
  email: string;
}

export interface InviteFamilyMemberResponse {
  inviteId: string;
}

export interface InviteCallerContext {
  authUid: string | undefined;
  authToken: Record<string, unknown> | undefined;
  /** Origin header from the calling browser. Validated against the same
   *  allowlist used by the login flow. */
  requestOrigin: string | undefined | null;
}

// No default: empty/whitespace fails loudly inside `sendTemplate` before
// hitting Resend (mirrors RESEND_LOGIN_TEMPLATE_ID, issue #149).
const resendInviteTemplateId = defineString("RESEND_INVITE_TEMPLATE_ID");

/**
 * Pure handler — exported so integration tests can drive it without going
 * through the onCall envelope. Mirrors the `handleRequestLoginCode` /
 * `requestLoginCode` split in the login-code module.
 */
export async function handleInviteFamilyMember(
  input: InviteFamilyMemberRequest,
  caller: InviteCallerContext,
): Promise<InviteFamilyMemberResponse> {
  const { membershipId, email } = input ?? ({} as InviteFamilyMemberRequest);
  if (!membershipId) {
    throw new HttpsError("invalid-argument", "membershipId is required");
  }
  if (!email || typeof email !== "string") {
    throw new HttpsError("invalid-argument", "email is required");
  }
  const normalizedEmail = email.trim().toLowerCase();

  const origin = isAllowedOrigin(caller.requestOrigin)
    ? caller.requestOrigin!
    : null;
  if (!origin) {
    // Mirrors `requestLoginCode` — the email link must point to an origin
    // the user actually trusts; refuse to send to an attacker-controlled
    // domain even if the calling client is happy to.
    throw new HttpsError("failed-precondition", "unknown request origin");
  }

  const database = db();
  const callerRef = callerUserRef(database, caller.authUid, caller.authToken);
  const isAdmin = caller.authToken?.admin === true;
  const memRef = membershipRef(database, membershipId);

  // Soft lookup — `inviteeRef` may be null when the email has never signed
  // in. The single-active-membership invariant is re-checked at accept
  // time, so missing here is fine.
  const inviteeRef = await findUserByEmail(database, normalizedEmail);

  const inviteRef = memRef.collection("invites").doc();

  await database.runTransaction(async (tx) => {
    const membership = await getMembershipInTx(tx, memRef);
    assertOwnerOrAdmin(membership, callerRef, isAdmin);

    if (membership.type !== "family") {
      throw new HttpsError(
        "failed-precondition",
        "Only family memberships can have invites",
      );
    }
    if (membership.status !== "active") {
      throw new HttpsError(
        "failed-precondition",
        "Membership is not active",
      );
    }

    if (inviteeRef) {
      if (membership.members.some((m) => m.id === inviteeRef.id)) {
        throw new HttpsError(
          "already-exists",
          "User is already a member of this family",
        );
      }
      // Single-active-membership invariant — re-checked at accept time too.
      await assertNoOtherActiveMembership(tx, inviteeRef, membershipId);
    }

    const now = Timestamp.now();
    const invite: MembershipInviteEntity = {
      email: normalizedEmail,
      status: "pending",
      invitedAt: now,
      invitedBy: callerRef as DocumentReference,
      resolvedAt: null,
      ttlAt: Timestamp.fromMillis(now.toMillis() + INVITE_TTL_MS),
    };
    tx.set(inviteRef, invite);
  });

  const acceptLink = `${origin}/account/invite/${membershipId}/${inviteRef.id}`;

  // Resolve display strings for the email body. Best-effort: a stale or
  // missing user doc shouldn't block the invite from being delivered.
  const inviterName = await resolveInviterName(callerRef);
  const membershipName = `Familie ${inviterName}`;

  if (isEmulator()) {
    // Surface the link both ways: the log line is convenient when watching
    // emulator output, the debug doc field unlocks Playwright E2E reads
    // (per the project pattern for OTP/code flows).
    await inviteRef.update({ debugLink: acceptLink });
    logger.info(
      `[invite] EMULATOR link for ${normalizedEmail}: ${acceptLink}`,
    );
  } else {
    try {
      await sendTemplate({
        to: normalizedEmail,
        templateId: resendInviteTemplateId.value(),
        templateIdParam: "RESEND_INVITE_TEMPLATE_ID",
        variables: {
          INVITER_NAME: inviterName,
          MEMBERSHIP_NAME: membershipName,
          ACCEPT_LINK: acceptLink,
        },
      });
    } catch (err) {
      // The invite doc has already been written; don't roll it back AND
      // don't surface the failure to the inviter. Returning an error here
      // would trip the "Einladung fehlgeschlagen" toast in the UI, falsely
      // implying nothing was created — but the invite *is* in the
      // sub-collection and the owner can revoke or (future) "Erneut senden"
      // it. The send-failure log line is the canary for ops.
      logger.error("Failed to send invite email — invite was created", {
        err,
        membershipId,
        inviteId: inviteRef.id,
        email: normalizedEmail,
      });
    }
  }

  logger.info("Created family invite", {
    membershipId,
    inviteId: inviteRef.id,
    email: normalizedEmail,
    ownerId: callerRef.id,
    inviteeExisted: inviteeRef !== null,
  });

  return { inviteId: inviteRef.id };
}

export const inviteFamilyMember = onCall<
  InviteFamilyMemberRequest,
  Promise<InviteFamilyMemberResponse>
>({ secrets: [resendApiKey] }, async (request) => {
  return handleInviteFamilyMember(request.data, {
    authUid: request.auth?.uid,
    authToken: request.auth?.token as Record<string, unknown> | undefined,
    requestOrigin:
      (request.rawRequest.headers.origin as string | undefined) ?? null,
  });
});

/**
 * Best-effort display name for the inviter, in priority order:
 *   1. `firstName lastName` (trimmed)
 *   2. `email` local-part
 *   3. literal "Jemand" (German for "someone") as the last resort
 */
export async function resolveInviterName(
  callerRef: DocumentReference,
): Promise<string> {
  try {
    const snap = await callerRef.get();
    if (!snap.exists) return "Jemand";
    const user = snap.data() as UserEntity;
    const fullName = formatFullName(user);
    if (fullName.length > 0) return fullName;
    if (user.email && user.email.includes("@")) {
      return user.email.split("@")[0];
    }
    return "Jemand";
  } catch (err) {
    logger.warn("Failed to resolve inviter name; falling back", { err });
    return "Jemand";
  }
}
