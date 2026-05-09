// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Callable: start a self-service membership purchase.
 *
 * Validates that the caller is signed in (real login, not tag-tap), has no
 * other active membership, and the requested SKU exists. Appends the
 * membership-fee catalog item to the user's existing open checkout; if the
 * user has no open checkout, a fresh one is created with
 * `usageType: "materialbezug"` (entry fee = 0 for every userType, so the
 * bill is just the membership SKU). The post-checkout trigger
 * (`processMembershipPayment`) detects membership purchases by the catalog
 * `kind` discriminator regardless of the parent checkout's usageType.
 *
 * For renewals (caller already has an active membership), pass
 * `renewExisting: true` — we re-use the existing membership doc and just
 * append a new fee item. The trigger handles type changes / extensions.
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
import { callerUserRef, db, detectMembershipKindForItems } from "./shared";

export interface PurchaseMembershipRequest {
  type: MembershipType;
  /**
   * Allow renewing an existing active membership. Without this flag, the
   * callable refuses when the caller already has an active membership (so
   * the UI is forced to confirm the renew intent explicitly).
   */
  renewExisting?: boolean;
}

export interface PurchaseMembershipResponse {
  checkoutId: string;
  catalogId: string;
  unitPrice: number;
}

export interface PurchaseMembershipCallerContext {
  authUid: string | undefined;
  authToken: Record<string, unknown> | undefined;
}

/**
 * Pure handler — exported so integration tests can drive it without going
 * through the onCall envelope. Mirrors the `handleInviteFamilyMember` /
 * `inviteFamilyMember` split.
 */
export async function handlePurchaseMembership(
  input: PurchaseMembershipRequest,
  caller: PurchaseMembershipCallerContext,
): Promise<PurchaseMembershipResponse> {
  const { type, renewExisting } = input ?? ({} as PurchaseMembershipRequest);
  if (type !== "single" && type !== "family") {
    throw new HttpsError("invalid-argument", "type must be 'single' or 'family'");
  }

  const database = db();
  const callerRef = callerUserRef(database, caller.authUid, caller.authToken);
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

  // Find-or-create the user's open checkout and append the fee item.
  // Mirrors the pattern in session/handle_upload_usage.ts so a parallel
  // "buy membership" purchase doesn't strand the user behind the
  // openCheckouts[0] pick in the web wizard.
  const now = Timestamp.now();
  const item: CheckoutItemEntity = {
    workshop: "diverses",
    description: catalog.name,
    origin: "manual",
    catalogId: catalogDoc.ref,
    created: now,
    quantity: 1,
    unitPrice,
    totalPrice: unitPrice,
  };

  const openCheckoutsSnap = await database
    .collection("checkouts")
    .where("userId", "==", callerRef as DocumentReference)
    .where("status", "==", "open")
    .limit(1)
    .get();

  let checkoutRef: DocumentReference;
  if (openCheckoutsSnap.empty) {
    checkoutRef = database.collection("checkouts").doc();
    const newCheckout: CheckoutEntity = {
      userId: callerRef as DocumentReference,
      status: "open",
      usageType: "materialbezug",
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
    const itemRef = checkoutRef.collection("items").doc();
    await database.runTransaction(async (tx) => {
      tx.set(checkoutRef, newCheckout);
      tx.set(itemRef, item);
    });
  } else {
    checkoutRef = openCheckoutsSnap.docs[0].ref;
    // Wrap the items read + dedup + write in a transaction so a concurrent
    // purchase that snuck a membership SKU into the same checkout between
    // our read and write forces a retry. Without this, two double-clicks
    // can both pass the guard and append duplicate line items. The UI
    // also gates the buy buttons; this is the server-side backstop.
    await database.runTransaction(async (tx) => {
      const existingItemsSnap = await tx.get(checkoutRef.collection("items"));
      const existingItems = existingItemsSnap.docs.map(
        (d) => d.data() as CheckoutItemEntity,
      );
      const existingMembership = await detectMembershipKindForItems(
        database,
        existingItems,
      );
      if (existingMembership !== null) {
        throw new HttpsError(
          "already-exists",
          "Eine Mitgliedschaft ist bereits im offenen Checkout.",
        );
      }
      const newItemRef = checkoutRef.collection("items").doc();
      tx.set(newItemRef, item);
      tx.update(checkoutRef, {
        modifiedBy: callerRef.id,
        modifiedAt: now,
      });
    });
  }

  logger.info("Started membership purchase", {
    userId: callerRef.id,
    type,
    checkoutId: checkoutRef.id,
    catalogId: catalogDoc.id,
    unitPrice,
    reusedExistingCheckout: !openCheckoutsSnap.empty,
  });

  return {
    checkoutId: checkoutRef.id,
    catalogId: catalogDoc.id,
    unitPrice,
  };
}

export const purchaseMembership = onCall<
  PurchaseMembershipRequest,
  Promise<PurchaseMembershipResponse>
>(async (request) => {
  return handlePurchaseMembership(request.data, {
    authUid: request.auth?.uid,
    authToken: request.auth?.token as Record<string, unknown> | undefined,
  });
});
