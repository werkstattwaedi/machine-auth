// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Callable: read public-facing info for a family invite from its (unguessable)
 * link, WITHOUT requiring sign-in.
 *
 * The acceptance landing page is reachable by an invitee who has no account yet
 * and therefore can't read the invite doc directly (Firestore rules require a
 * signed-in, email-matching principal). This callable returns just enough to
 * render the page and branch the UX:
 *   - `status`       — pending / accepted / rejected / revoked / expired / not_found
 *   - `email`        — the invited address (so the page can show it / prefill)
 *   - `inviterName`  — for the "Familie X" heading
 *   - `accountExists`— a *completed* account already exists for the email, so the
 *                      page sends the user to normal login instead of the no-code
 *                      sign-up path (a leaked link must not pseudo-login an
 *                      existing account).
 *
 * Origin-gated like `checkAccountExists` / `requestLoginCode`. The link itself
 * (random doc id, delivered to the invited address) is the bearer secret.
 */

import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import type {
  MembershipEntity,
  MembershipInviteEntity,
} from "../types/firestore_entities";
import { db, membershipRef } from "./shared";
import { resolveInviter } from "./invite";
import { isAllowedOrigin } from "../auth/login-code/helpers";

export interface GetFamilyInviteInfoRequest {
  membershipId: string;
  inviteId: string;
}

export type FamilyInviteStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "revoked"
  | "expired"
  | "not_found";

export interface GetFamilyInviteInfoResult {
  status: FamilyInviteStatus;
  email: string | null;
  inviterName: string;
  inviterEmail: string | null;
  accountExists: boolean;
}

export async function handleGetFamilyInviteInfo(
  input: GetFamilyInviteInfoRequest,
  requestOrigin: string | undefined | null,
): Promise<GetFamilyInviteInfoResult> {
  const { membershipId, inviteId } = input ?? ({} as GetFamilyInviteInfoRequest);
  if (!membershipId || !inviteId) {
    throw new HttpsError(
      "invalid-argument",
      "membershipId and inviteId are required",
    );
  }
  if (!isAllowedOrigin(requestOrigin)) {
    throw new HttpsError("failed-precondition", "unknown request origin");
  }

  const database = db();
  const memRef = membershipRef(database, membershipId);
  const memSnap = await memRef.get();
  // A missing or non-family membership is indistinguishable from a stale link
  // to the invitee — return the neutral "not_found" rather than leaking which.
  if (!memSnap.exists || (memSnap.data() as MembershipEntity).type !== "family") {
    return { status: "not_found", email: null, inviterName: "Jemand", inviterEmail: null, accountExists: false };
  }

  const inviteSnap = await memRef.collection("invites").doc(inviteId).get();
  if (!inviteSnap.exists) {
    return { status: "not_found", email: null, inviterName: "Jemand", inviterEmail: null, accountExists: false };
  }
  const invite = inviteSnap.data() as MembershipInviteEntity;

  // Single read resolves both the display name and email for the
  // "Du wurdest von X (email) eingeladen" copy.
  const { name: inviterName, email: inviterEmail } = await resolveInviter(
    invite.invitedBy,
  );

  // Pending invites past their TTL are functionally expired even if the TTL
  // reaper hasn't deleted them yet.
  let status: FamilyInviteStatus = invite.status;
  if (
    invite.status === "pending" &&
    invite.ttlAt != null &&
    invite.ttlAt.toMillis() < Date.now()
  ) {
    status = "expired";
  }

  // "Completed account" = a user doc with accepted terms. A bare Auth user
  // (abandoned signup) is NOT completed and may still use the no-code path.
  const userSnap = await database
    .collection("users")
    .where("email", "==", invite.email)
    .limit(1)
    .get();
  const accountExists =
    !userSnap.empty && userSnap.docs[0].get("termsAcceptedAt") != null;

  return { status, email: invite.email, inviterName, inviterEmail, accountExists };
}

export const getFamilyInviteInfoHandler = async (
  request: CallableRequest<GetFamilyInviteInfoRequest>,
) => {
  const origin =
    (request.rawRequest.headers.origin as string | undefined) ?? null;
  return handleGetFamilyInviteInfo(request.data, origin);
};
