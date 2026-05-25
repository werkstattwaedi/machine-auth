// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Callable: cancel a membership's annual auto-renewal (issue #323).
 *
 * Sets `autoRenew = false` so the daily `renewalInvoicer` cron stops
 * auto-issuing a renewal QR-Rechnung ~30 days before `validUntil`. This
 * is intentionally side-effect-light: the membership stays `active` and
 * keeps its `validUntil` — the member simply isn't billed again. The
 * existing `cancelMembership` callable (status → "cancelled") is the
 * heavier "deactivate now" path; this one is the "let it lapse" path.
 *
 * Owner can cancel their own auto-renewal; admin can cancel any. Mirrors
 * the auth shape of `cancelMembership`.
 */

import * as logger from "firebase-functions/logger";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import {
  assertOwnerOrAdmin,
  callerUserRef,
  db,
  getMembershipInTx,
  membershipRef,
} from "./shared";

interface CancelMembershipAutoRenewRequest {
  membershipId: string;
}

export const cancelMembershipAutoRenew = onCall<
  CancelMembershipAutoRenewRequest,
  Promise<{ ok: true }>
>(async (request) => {
  const { membershipId } =
    request.data ?? ({} as CancelMembershipAutoRenewRequest);
  if (!membershipId) {
    throw new HttpsError("invalid-argument", "membershipId is required");
  }

  const database = db();
  const callerRef = callerUserRef(
    database,
    request.auth?.uid,
    request.auth?.token as Record<string, unknown> | undefined,
  );
  const isAdmin = request.auth?.token?.admin === true;
  const memRef = membershipRef(database, membershipId);

  await database.runTransaction(async (tx) => {
    const membership = await getMembershipInTx(tx, memRef);
    assertOwnerOrAdmin(membership, callerRef, isAdmin);
    // Idempotent: a second call after auto-renew is already off is fine.
    tx.update(memRef, {
      autoRenew: false,
      modifiedAt: FieldValue.serverTimestamp(),
      modifiedBy: callerRef.id,
    });
  });

  logger.info("Cancelled membership auto-renewal", {
    membershipId,
    callerId: callerRef.id,
    isAdmin,
  });

  return { ok: true };
});
