// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Callable: list the pending family invites addressed to the signed-in user's
 * email, across all memberships. Powers the "you've been invited — join here"
 * banner on the membership page.
 *
 * Done server-side (admin SDK) rather than a client collection-group query so
 * we don't depend on collection-group read rules / client index setup, and so
 * we can resolve the inviter's display name (which the invitee can't read
 * directly).
 */

import * as logger from "firebase-functions/logger";
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import type { MembershipInviteEntity } from "../types/firestore_entities";
import { callerEmail, callerUserRef, db } from "./shared";
import { resolveInviterName } from "./invite";

export interface ListMyFamilyInvitesResult {
  invites: Array<{
    membershipId: string;
    inviteId: string;
    inviterName: string;
  }>;
}

export const listMyFamilyInvitesHandler = async (
  request: CallableRequest<unknown>,
): Promise<ListMyFamilyInvitesResult> => {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Sign-in required");
  }
  // Elevated kiosk sessions resolve their e-mail from the user doc (no
  // `email` claim on a synthetic token — ADR-0041); un-elevated tag
  // sessions are rejected by callerUserRef like every membership callable.
  const token = request.auth.token as Record<string, unknown> | undefined;
  const callerRef = callerUserRef(db(), request.auth.uid, token);
  const email = await callerEmail(callerRef, token);
  if (!email) return { invites: [] };

  // Single-equality collection-group query (status filtered below to avoid a
  // composite index).
  const snap = await db()
    .collectionGroup("invites")
    .where("email", "==", email)
    .get();

  const now = Date.now();
  const pending = snap.docs.filter((d) => {
    const inv = d.data() as MembershipInviteEntity;
    if (inv.status !== "pending") return false;
    if (inv.ttlAt != null && inv.ttlAt.toMillis() < now) return false;
    return d.ref.parent.parent != null;
  });

  const invites = await Promise.all(
    pending.map(async (d) => {
      const inv = d.data() as MembershipInviteEntity;
      return {
        membershipId: d.ref.parent.parent!.id,
        inviteId: d.id,
        inviterName: await resolveInviterName(inv.invitedBy),
      };
    }),
  );

  logger.debug("Listed pending family invites", {
    userId: request.auth.uid,
    count: invites.length,
  });

  return { invites };
};
