// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Callable: start a self-service membership purchase.
 *
 * Validates that the caller is signed in (real login, not tag-tap), has no
 * other active membership, and the requested SKU exists. Creates an open
 * checkout containing the membership-fee catalog item. The client then
 * proceeds to pay via the existing `closeCheckoutAndGetPayment` flow; the
 * post-checkout trigger (`processMembershipPayment`) creates or extends the
 * membership when payment is recorded.
 *
 * For renewals (caller already has an active membership), pass
 * `renewExisting: true` — we re-use the existing membership doc and just
 * create a new fee checkout. The trigger handles type changes / extensions.
 */

import * as logger from "firebase-functions/logger";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import {
  Timestamp,
  type DocumentReference,
} from "firebase-admin/firestore";
import type {
  CatalogEntity,
  CatalogItemKind,
  CheckoutEntity,
  CheckoutItemEntity,
  MembershipType,
  UserEntity,
} from "../types/firestore_entities";
import { callerUserRef, db } from "./shared";

interface PurchaseMembershipRequest {
  type: MembershipType;
  /**
   * Allow renewing an existing active membership. Without this flag, the
   * callable refuses when the caller already has an active membership (so
   * the UI is forced to confirm the renew intent explicitly).
   */
  renewExisting?: boolean;
}

interface PurchaseMembershipResponse {
  checkoutId: string;
  catalogId: string;
  unitPrice: number;
}

export const purchaseMembership = onCall<
  PurchaseMembershipRequest,
  Promise<PurchaseMembershipResponse>
>(async (request) => {
  const { type, renewExisting } = request.data ?? ({} as PurchaseMembershipRequest);
  if (type !== "single" && type !== "family") {
    throw new HttpsError("invalid-argument", "type must be 'single' or 'family'");
  }

  const database = db();
  const callerRef = callerUserRef(
    database,
    request.auth?.uid,
    request.auth?.token as Record<string, unknown> | undefined,
  );
  const userSnap = await callerRef.get();
  if (!userSnap.exists) {
    throw new HttpsError("not-found", "Caller user doc not found");
  }
  const user = userSnap.data() as UserEntity;

  if (user.activeMembership && !renewExisting) {
    throw new HttpsError(
      "failed-precondition",
      "Caller already has an active membership; pass renewExisting to renew",
    );
  }

  // Locate the catalog SKU for the requested membership type. We use the
  // `kind` discriminator rather than hardcoded doc IDs so prices/labels
  // can be edited freely. Active SKU only — staff disable an old fee item
  // by toggling `active: false` rather than deleting.
  const wantedKind: CatalogItemKind =
    type === "single" ? "membership-single" : "membership-family";
  const catalogSnap = await database
    .collection("catalog")
    .where("kind", "==", wantedKind)
    .where("active", "==", true)
    .limit(1)
    .get();
  if (catalogSnap.empty) {
    logger.error("Membership catalog SKU not configured", { wantedKind });
    throw new HttpsError(
      "failed-precondition",
      `No active catalog item for ${wantedKind}`,
    );
  }
  const catalogDoc = catalogSnap.docs[0];
  const catalog = catalogDoc.data() as CatalogEntity;
  // Membership fees use the same pricing tiers as everything else; the
  // member-renewal price is the `member` tier, first-time signup is `none`.
  // Server is authoritative here so a stale client-side discount can't
  // sneak through.
  const tier: keyof CatalogEntity["unitPrice"] = user.activeMembership
    ? "member"
    : "none";
  const unitPrice = catalog.unitPrice[tier] ?? catalog.unitPrice.none ?? 0;
  if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
    throw new HttpsError(
      "failed-precondition",
      `Catalog item ${catalogDoc.id} has invalid unitPrice for tier ${tier}`,
    );
  }

  // Create the open checkout for the fee. The membership-trigger waits for
  // it to close (= paid via the existing closeCheckoutAndGetPayment flow).
  const checkoutRef = database.collection("checkouts").doc();
  const itemRef = checkoutRef.collection("items").doc();
  const now = Timestamp.now();

  // usageType: "membership" — entry-fee row is 0 for every userType, so
  // the bill is just the membership SKU itself (no workshop fee piled on
  // top). closeCheckoutAndGetPayment + create_bill both look up the row
  // by [userType][usageType], so this routes cleanly through both paths.
  const checkout: CheckoutEntity = {
    userId: callerRef as DocumentReference,
    status: "open",
    usageType: "membership",
    created: now,
    workshopsVisited: [],
    persons: [
      {
        name:
          user.displayName ??
          `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() ??
          (user.email ?? ""),
        email: user.email ?? "",
        userType: user.userType ?? "erwachsen",
        userRef: callerRef as DocumentReference,
      },
    ],
    modifiedBy: callerRef.id,
    modifiedAt: now,
  };
  const item: CheckoutItemEntity = {
    workshop: "membership",
    description: catalog.name,
    origin: "manual",
    catalogId: catalogDoc.ref,
    created: now,
    quantity: 1,
    unitPrice,
    totalPrice: unitPrice,
  };

  await database.runTransaction(async (tx) => {
    tx.set(checkoutRef, checkout);
    tx.set(itemRef, item);
  });

  logger.info("Started membership purchase", {
    userId: callerRef.id,
    type,
    checkoutId: checkoutRef.id,
    catalogId: catalogDoc.id,
    unitPrice,
  });

  return {
    checkoutId: checkoutRef.id,
    catalogId: catalogDoc.id,
    unitPrice,
  };
});
