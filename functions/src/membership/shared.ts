// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Shared utilities for the membership module:
 *  - Eligibility checks for the single-active-membership invariant.
 *  - Period helpers (1-year extension semantics).
 *  - Common error codes / lookups.
 */

import * as logger from "firebase-functions/logger";
import { HttpsError } from "firebase-functions/v2/https";
import {
  getFirestore,
  Timestamp,
  type DocumentReference,
  type Firestore,
  type Transaction,
} from "firebase-admin/firestore";
import type {
  CatalogEntity,
  CheckoutItemEntity,
  MembershipEntity,
  MembershipType,
  UserEntity,
} from "../types/firestore_entities";

export const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
export const INVITE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function membershipTypeForCatalogKind(
  kind: string | null | undefined,
): MembershipType | null {
  if (kind === "membership-single") return "single";
  if (kind === "membership-family") return "family";
  return null;
}

/**
 * Inspect a checkout's items and return the membership type implied by any
 * membership-fee SKU present, or null if none. Resolves each item's catalog
 * doc to read its `kind` discriminator. Family wins over single (higher tier
 * supersedes) — same disambiguation rule as `processMembershipPayment`.
 *
 * Used by `purchaseMembership` to reject double-adds and by the post-checkout
 * trigger to decide whether to create/extend a membership.
 */
export async function detectMembershipKindForItems(
  database: Firestore,
  items: CheckoutItemEntity[],
): Promise<MembershipType | null> {
  const catalogIds = items
    .map((i) => i.catalogId)
    .filter((r): r is DocumentReference => r != null);
  if (catalogIds.length === 0) return null;

  const catalogDocs = await Promise.all(catalogIds.map((r) => r.get()));
  const kinds = catalogDocs
    .map((d) => (d.data() as CatalogEntity | undefined)?.kind ?? null)
    .map((k) => membershipTypeForCatalogKind(k))
    .filter((k): k is MembershipType => k !== null);

  if (kinds.length === 0) return null;
  if (kinds.includes("family")) {
    if (kinds.includes("single")) {
      // Both kinds in one checkout = bug somewhere upstream (the UI offers
      // a single radio choice, the callable validates type per call, the
      // dedup guard rejects re-adds). Surface it loudly so staff can spot
      // it; we still proceed with `family` as the higher tier.
      logger.warn(
        "Checkout contains both single and family membership SKUs — using family",
      );
    }
    return "family";
  }
  return "single";
}

/**
 * One year forward from `from`. Used for `validUntil` math: paying early
 * extends rather than resets. Callers pass `max(now, currentValidUntil)`.
 */
export function plusOneYear(from: Timestamp): Timestamp {
  return Timestamp.fromMillis(from.toMillis() + ONE_YEAR_MS);
}

/**
 * Throws `failed-precondition` when the user already has an `activeMembership`
 * pointing to a different membership doc. The single-active-membership
 * invariant is enforced inside callable transactions; without it, two
 * concurrent invites/admin assignments could land a user in two memberships
 * simultaneously.
 *
 * Pass the in-progress membership ref via `excludeMembershipId` so the
 * "already in this same membership" case isn't flagged.
 */
export async function assertNoOtherActiveMembership(
  tx: Transaction,
  userRef: DocumentReference,
  excludeMembershipId: string | null,
): Promise<UserEntity> {
  const userDoc = await tx.get(userRef);
  if (!userDoc.exists) {
    throw new HttpsError("not-found", `User ${userRef.id} not found`);
  }
  const user = userDoc.data() as UserEntity;
  const existing = user.activeMembership ?? null;
  if (existing && existing.id !== excludeMembershipId) {
    throw new HttpsError(
      "failed-precondition",
      `User ${userRef.id} already has an active membership (${existing.id})`,
    );
  }
  return user;
}

/**
 * Resolve a Firestore user-doc reference for the caller of a callable.
 *
 * Tag-tap (kiosk badge) sessions are intentionally rejected: a tag session is
 * not an authenticated channel for managing one's membership — the family
 * payer must be on the checkout app with their own login. Real signed-in
 * users (email-link auth) and admin sessions are accepted.
 *
 * Accepts the auth token as `Record<string, unknown> | undefined` because
 * firebase-functions surfaces it as a strongly-typed `DecodedIdToken` that
 * doesn't expose our `actsAs` custom claim by name.
 */
export function callerUserRef(
  db: Firestore,
  authUid: string | undefined,
  authToken: Record<string, unknown> | undefined,
): DocumentReference {
  if (!authUid) {
    throw new HttpsError("unauthenticated", "Sign-in required");
  }
  const actsAs = authToken?.["actsAs"];
  if (typeof actsAs === "string" && actsAs.length > 0) {
    throw new HttpsError(
      "permission-denied",
      "Tag-tap sessions cannot manage memberships",
    );
  }
  return db.collection("users").doc(authUid);
}

/**
 * Find a user by email. Returns null if no match. Email is normalized to
 * lowercase before lookup. Caller is expected to handle the null case (we
 * surface a clean `not-found` when invitee is missing rather than auto-
 * creating an account from a callable).
 */
export async function findUserByEmail(
  db: Firestore,
  email: string,
): Promise<DocumentReference | null> {
  const normalized = email.trim().toLowerCase();
  if (normalized.length === 0) return null;
  const snap = await db
    .collection("users")
    .where("email", "==", normalized)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return snap.docs[0].ref;
}

/**
 * Convenience getter for an authoritative DB handle. Wrapping `getFirestore`
 * keeps callable files small and avoids leaking firebase-admin imports
 * across the module boundary.
 */
export function db(): Firestore {
  return getFirestore();
}

export function membershipRef(
  database: Firestore,
  membershipId: string,
): DocumentReference {
  return database.collection("memberships").doc(membershipId);
}

/**
 * Read a membership doc inside a transaction, throwing `not-found` cleanly.
 */
export async function getMembershipInTx(
  tx: Transaction,
  ref: DocumentReference,
): Promise<MembershipEntity> {
  const snap = await tx.get(ref);
  if (!snap.exists) {
    throw new HttpsError("not-found", `Membership ${ref.id} not found`);
  }
  return snap.data() as MembershipEntity;
}

/**
 * Throws `permission-denied` when the caller is not the owner of the
 * membership and not an admin. Callers pass `isAdmin` from their request
 * context.
 */
export function assertOwnerOrAdmin(
  membership: MembershipEntity,
  callerRef: DocumentReference,
  isAdmin: boolean,
): void {
  if (isAdmin) return;
  if (membership.ownerUserId.id !== callerRef.id) {
    throw new HttpsError(
      "permission-denied",
      "Only the membership owner or an admin can perform this action",
    );
  }
}
