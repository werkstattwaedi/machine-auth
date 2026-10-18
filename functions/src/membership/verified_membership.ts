// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * `users/{uid}.activeMembership` is a denormalized pointer. The rules keep
 * clients from writing it (issue #745), but docs written before that fix
 * may still carry a pointer to a membership the user was never part of.
 * Everything that *grants* something because of a membership (member
 * prices, Sammelrechnung, a free badge) therefore asks the membership doc
 * itself — active, and listing the user in `members[]` — instead of
 * trusting the pointer.
 */

import * as logger from "firebase-functions/logger";
import type {
  DocumentReference,
  DocumentSnapshot,
  Transaction,
} from "firebase-admin/firestore";
import type {
  MembershipEntity,
  UserEntity,
} from "../types/firestore_entities";

export interface VerifiedMembership {
  ref: DocumentReference;
  data: MembershipEntity;
}

/**
 * The membership `user.activeMembership` points at, if it is active and
 * lists `userRef` in `members[]`; otherwise null. Costs no read when the
 * pointer is unset, one read otherwise. Pass `tx` to read inside a
 * transaction (before any of its writes).
 *
 * `validUntil` is deliberately not checked here: the expiry job flips
 * `status`, and callers that must not wait for it (usage pricing) check
 * `validUntil` themselves.
 */
export async function resolveVerifiedMembership(
  userRef: DocumentReference,
  user: Pick<UserEntity, "activeMembership"> | undefined,
  tx?: Transaction,
): Promise<VerifiedMembership | null> {
  const pointer = user?.activeMembership ?? null;
  if (!pointer) return null;
  const snap: DocumentSnapshot = tx
    ? await tx.get(pointer)
    : await pointer.get();
  const data = snap.data() as MembershipEntity | undefined;
  const listed = (data?.members ?? []).some((m) => m.path === userRef.path);
  if (data && data.status === "active" && listed) {
    return { ref: pointer, data };
  }
  logger.warn("activeMembership pointer not backed by the membership", {
    userId: userRef.id,
    membershipId: pointer.id,
    exists: snap.exists,
    status: data?.status ?? null,
    listed,
  });
  return null;
}
