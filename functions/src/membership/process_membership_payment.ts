// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Trigger: when a checkout closes containing a membership-fee catalog item,
 * create or extend the corresponding membership.
 *
 * Two trigger entrypoints (mirroring the bill-creation triggers in
 * invoice/create_bill.ts):
 *   - onCheckoutClosedForMembership: open → closed update path
 *   - onCheckoutCreatedClosedForMembership: anonymous one-shot create path
 *
 * Both delegate to `processMembershipPayment(checkoutRef, checkout)`.
 *
 * Idempotency: each membership records `paymentCheckouts: DocumentReference[]`.
 * If the trigger sees a checkout already in that array, it no-ops. This
 * matches the pattern used by createBillForCheckout (skip if billRef set).
 */

import * as logger from "firebase-functions/logger";
import {
  onDocumentCreated,
  onDocumentUpdated,
} from "firebase-functions/v2/firestore";
import {
  FieldValue,
  Timestamp,
  type DocumentReference,
  type Firestore,
} from "firebase-admin/firestore";
import type {
  CheckoutEntity,
  CheckoutItemEntity,
  MembershipEntity,
  MembershipType,
} from "../types/firestore_entities";
import {
  db,
  detectMembershipKindForItems,
  loadMembershipCatalogId,
  plusOneYear,
} from "./shared";

/**
 * Inspect a closed checkout and, for any membership-fee items it contains,
 * create or extend the user's membership. Exported for integration tests
 * (the Firestore trigger wrapper isn't started in the test harness).
 */
export async function processMembershipPayment(
  checkoutRef: DocumentReference,
  checkout: CheckoutEntity,
): Promise<void> {
  if (checkout.status !== "closed") return;
  if (!checkout.userId) {
    // Anonymous checkouts cannot purchase a membership — there's no user
    // record to attach it to. The catalog UI gates this client-side; this
    // is just defense-in-depth.
    return;
  }

  const itemsSnap = await checkoutRef.collection("items").get();
  const items = itemsSnap.docs.map((d) => d.data() as CheckoutItemEntity);
  if (items.length === 0) return;

  const database = db();
  const membershipCatalogId = await loadMembershipCatalogId(database);
  if (!membershipCatalogId) {
    // No membership SKU configured — checkout cannot contain one. No-op.
    return;
  }
  const membershipKindForCheckout = await detectMembershipKindForItems(
    database,
    items,
    membershipCatalogId,
  );
  if (!membershipKindForCheckout) return;

  const userRef = checkout.userId;
  await applyMembershipPayment(
    database,
    userRef,
    membershipKindForCheckout,
    checkoutRef,
  );
  logger.info("Applied membership payment", {
    checkoutId: checkoutRef.id,
    userId: userRef.id,
    type: membershipKindForCheckout,
  });
}

/**
 * Atomically create or extend the user's membership and append this checkout
 * to its `paymentCheckouts` audit trail.
 *
 * Period semantics: paying early extends; paying after expiry restarts from
 * `now`. We use `max(now, validUntil) + 1y`.
 *
 * Type changes: if the user's existing membership is a different type than
 * the one paid for (e.g. they had `single`, paid for `family`), we upgrade
 * in place — same membership doc, new type.
 */
async function applyMembershipPayment(
  database: Firestore,
  userRef: DocumentReference,
  paidType: MembershipType,
  checkoutRef: DocumentReference,
): Promise<void> {
  await database.runTransaction(async (tx) => {
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) {
      throw new Error(`User ${userRef.id} not found`);
    }

    const activeRef = (userSnap.data()?.activeMembership ?? null) as
      | DocumentReference
      | null;

    let membershipRef: DocumentReference;
    let existing: MembershipEntity | null = null;

    if (activeRef) {
      const existingSnap = await tx.get(activeRef);
      if (existingSnap.exists) {
        membershipRef = activeRef;
        existing = existingSnap.data() as MembershipEntity;
      } else {
        // The user's denormalized ref points at a deleted doc — treat as fresh.
        membershipRef = database.collection("memberships").doc();
      }
    } else {
      membershipRef = database.collection("memberships").doc();
    }

    if (existing) {
      // Idempotency: this checkout already counted toward the membership.
      if (existing.paymentCheckouts.some((r) => r.id === checkoutRef.id)) {
        return;
      }
    }

    const now = Timestamp.now();
    const baseline =
      existing && existing.validUntil.toMillis() > now.toMillis()
        ? existing.validUntil
        : now;
    const newValidUntil = plusOneYear(baseline);

    if (existing) {
      tx.update(membershipRef, {
        type: paidType,
        status: "active" as const,
        lastPaidAt: now,
        validUntil: newValidUntil,
        paymentCheckouts: FieldValue.arrayUnion(checkoutRef),
        modifiedAt: FieldValue.serverTimestamp(),
        modifiedBy: null, // server-side write
      });
    } else {
      const doc: MembershipEntity = {
        type: paidType,
        status: "active",
        lastPaidAt: now,
        validUntil: newValidUntil,
        ownerUserId: userRef,
        members: [userRef],
        paymentCheckouts: [checkoutRef],
        notes: null,
        created: now,
        createdBy: null,
        modifiedAt: now,
        modifiedBy: null,
      };
      tx.set(membershipRef, doc);
      // Eagerly stamp activeMembership on the user; the
      // onMembershipWritten trigger will reconcile but the user-facing
      // pricing path benefits from the fast path.
      tx.update(userRef, { activeMembership: membershipRef });
    }
  });
}

export const onCheckoutClosedForMembership = onDocumentUpdated(
  "checkouts/{checkoutId}",
  async (event) => {
    const before = event.data?.before.data() as CheckoutEntity | undefined;
    const after = event.data?.after.data() as CheckoutEntity | undefined;
    if (!before || !after) return;
    if (before.status === "closed" || after.status !== "closed") return;
    await processMembershipPayment(event.data!.after.ref, after);
  },
);

export const onCheckoutCreatedClosedForMembership = onDocumentCreated(
  "checkouts/{checkoutId}",
  async (event) => {
    const data = event.data?.data() as CheckoutEntity | undefined;
    if (!data) return;
    if (data.status !== "closed") return;
    await processMembershipPayment(event.data!.ref, data);
  },
);
