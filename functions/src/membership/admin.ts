// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Admin escape-hatch callables for membership management.
 *
 *  - adminCreateMembership: directly create + activate a membership without
 *    a checkout/payment (e.g., comp memberships, manual handling for
 *    bank-transfer payments).
 *  - adminExtendMembership: bump `validUntil` without payment (refunds,
 *    goodwill).
 *
 * Both require the `admin` custom claim on the caller. The
 * onMembershipWritten trigger handles `activeMembership` denormalization.
 */

import * as logger from "firebase-functions/logger";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import {
  FieldValue,
  Timestamp,
  type DocumentReference,
} from "firebase-admin/firestore";
import type {
  MembershipEntity,
  MembershipType,
} from "../types/firestore_entities";
import {
  assertNoOtherActiveMembership,
  db,
  membershipRef,
  plusOneYear,
} from "./shared";

interface AdminCreateMembershipRequest {
  type: MembershipType;
  ownerUserId: string;
  /**
   * Optional initial validity. Defaults to now + 1 year. Pass to grant
   * partial-year comp memberships.
   */
  validUntilMs?: number;
  notes?: string | null;
}

export const adminCreateMembership = onCall<
  AdminCreateMembershipRequest,
  Promise<{ membershipId: string }>
>(async (request) => {
  if (request.auth?.token?.admin !== true) {
    throw new HttpsError("permission-denied", "Admin access required");
  }
  const { type, ownerUserId, validUntilMs, notes } =
    request.data ?? ({} as AdminCreateMembershipRequest);
  if (type !== "single" && type !== "family") {
    throw new HttpsError("invalid-argument", "type must be 'single' or 'family'");
  }
  if (!ownerUserId) {
    throw new HttpsError("invalid-argument", "ownerUserId is required");
  }

  const database = db();
  const ownerRef = database.collection("users").doc(ownerUserId);
  const memRef = database.collection("memberships").doc();

  await database.runTransaction(async (tx) => {
    await assertNoOtherActiveMembership(tx, ownerRef, null);

    const now = Timestamp.now();
    const validUntil = validUntilMs
      ? Timestamp.fromMillis(validUntilMs)
      : plusOneYear(now);

    const doc: MembershipEntity = {
      type,
      status: "active",
      lastPaidAt: null,
      validUntil,
      ownerUserId: ownerRef as DocumentReference,
      members: [ownerRef as DocumentReference],
      paymentCheckouts: [],
      notes: notes ?? null,
      created: now,
      createdBy: request.auth?.uid ?? null,
      modifiedAt: now,
      modifiedBy: request.auth?.uid ?? null,
    };
    tx.set(memRef, doc);
  });

  logger.info("Admin created membership", {
    membershipId: memRef.id,
    ownerUserId,
    type,
    adminUid: request.auth?.uid,
  });

  return { membershipId: memRef.id };
});

interface AdminExtendMembershipRequest {
  membershipId: string;
  /** How many days to extend validUntil. Defaults to 365. */
  days?: number;
  /**
   * Required to extend a `cancelled` membership. Cancellation is an
   * intentional state — silently flipping it back to `active` would erase
   * a deliberate decision (often paired with a refund). Set this when an
   * admin really does want to resurrect, and add a `notes` entry too.
   */
  reactivateCancelled?: boolean;
}

export const adminExtendMembership = onCall<
  AdminExtendMembershipRequest,
  Promise<{ validUntilMs: number }>
>(async (request) => {
  if (request.auth?.token?.admin !== true) {
    throw new HttpsError("permission-denied", "Admin access required");
  }
  const { membershipId, days, reactivateCancelled } =
    request.data ?? ({} as AdminExtendMembershipRequest);
  if (!membershipId) {
    throw new HttpsError("invalid-argument", "membershipId is required");
  }
  const extensionMs = (days ?? 365) * 24 * 60 * 60 * 1000;
  if (extensionMs <= 0) {
    throw new HttpsError("invalid-argument", "days must be positive");
  }

  const database = db();
  const memRef = membershipRef(database, membershipId);

  let newValidUntilMs = 0;
  let priorStatus: string | null = null;
  await database.runTransaction(async (tx) => {
    const snap = await tx.get(memRef);
    if (!snap.exists) {
      throw new HttpsError("not-found", "Membership not found");
    }
    const membership = snap.data() as MembershipEntity;
    priorStatus = membership.status;

    if (membership.status === "cancelled" && !reactivateCancelled) {
      throw new HttpsError(
        "failed-precondition",
        "Membership is cancelled — pass reactivateCancelled to resurrect it",
      );
    }

    const now = Timestamp.now();
    const baselineMs = Math.max(membership.validUntil.toMillis(), now.toMillis());
    newValidUntilMs = baselineMs + extensionMs;
    tx.update(memRef, {
      validUntil: Timestamp.fromMillis(newValidUntilMs),
      status: "active",
      modifiedAt: FieldValue.serverTimestamp(),
      modifiedBy: request.auth?.uid ?? null,
    });
  });

  if (priorStatus === "cancelled") {
    logger.warn("adminExtendMembership reactivated cancelled membership", {
      membershipId,
      adminUid: request.auth?.uid,
    });
  }
  logger.info("Admin extended membership", {
    membershipId,
    days: days ?? 365,
    priorStatus,
    adminUid: request.auth?.uid,
  });

  return { validUntilMs: newValidUntilMs };
});
