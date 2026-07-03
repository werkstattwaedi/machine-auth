// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Shared utilities for the self-service badge purchase module:
 *  - Badge catalog resolution via `config/catalog-references.badge`.
 *  - Caller resolution that ACCEPTS kiosk actsAs sessions (unlike the
 *    membership module's `callerUserRef` — badge purchase happens at the
 *    kiosk, so the tag/email-code session IS the expected principal).
 *  - Badge item detection and the free-first-badge eligibility rule.
 */

import { HttpsError } from "firebase-functions/v2/https";
import type {
  DocumentReference,
  DocumentSnapshot,
  Firestore,
} from "firebase-admin/firestore";
import type {
  CatalogEntity,
  CatalogReferencesEntity,
  CheckoutItemEntity,
  UserEntity,
} from "../types/firestore_entities";

/** Variant ids on the badge catalog SKU (seed: scripts/seed-data/catalog/badge.json). */
export const BADGE_VARIANT_STANDARD = "standard";
export const BADGE_VARIANT_FREE = "gratis";

/**
 * Resolve the badge catalog doc via `config/catalog-references.badge`.
 * Throws `failed-precondition` when unconfigured/missing/inactive — badge
 * purchase cannot proceed without a priced SKU (price must come from the
 * catalog, never from code).
 */
export async function loadBadgeCatalog(
  database: Firestore
): Promise<{ ref: DocumentReference; catalog: CatalogEntity }> {
  const refsSnap = await database.doc("config/catalog-references").get();
  const refs = refsSnap.data() as CatalogReferencesEntity | undefined;
  if (!refs?.badge) {
    throw new HttpsError(
      "failed-precondition",
      "config/catalog-references.badge is missing"
    );
  }
  const catalogDoc = await refs.badge.get();
  const catalog = catalogDoc.data() as CatalogEntity | undefined;
  if (!catalogDoc.exists || !catalog) {
    throw new HttpsError(
      "failed-precondition",
      `No catalog doc at ${refs.badge.path}`
    );
  }
  if (!catalog.active) {
    throw new HttpsError(
      "failed-precondition",
      "Badge catalog item is inactive"
    );
  }
  return { ref: catalogDoc.ref, catalog };
}

/**
 * The user-doc reference the caller acts for. Accepts real logins AND kiosk
 * actsAs sessions (badge tap or email-code sign-in — ADR-0022); rejects
 * unauthenticated and Firebase-anonymous callers (a badge must be bound to
 * an account).
 */
export function effectiveCallerRef(
  database: Firestore,
  authUid: string | undefined,
  authToken: Record<string, unknown> | undefined
): DocumentReference {
  if (!authUid) {
    throw new HttpsError("unauthenticated", "Sign-in required");
  }
  const provider = (
    authToken as { firebase?: { sign_in_provider?: string } } | undefined
  )?.firebase?.sign_in_provider;
  if (provider === "anonymous") {
    throw new HttpsError(
      "permission-denied",
      "Für einen Badge-Kauf ist eine Anmeldung nötig."
    );
  }
  const actsAs = authToken?.["actsAs"];
  if (typeof actsAs === "string" && actsAs.length > 0) {
    return database.collection("users").doc(actsAs);
  }
  return database.collection("users").doc(authUid);
}

/**
 * A badge line item is recognized by its server-written `tokenId` —
 * firestore.rules deny that field on all client item writes, so presence is
 * authoritative (no catalog lookup needed at close time).
 */
export function isBadgeItem(
  item: Pick<CheckoutItemEntity, "tokenId">
): item is CheckoutItemEntity & { tokenId: string } {
  return typeof item.tokenId === "string" && item.tokenId.length > 0;
}

/**
 * Free-first-badge eligibility: active members, and anyone holding ANY
 * permission — every granted permission implicitly requires a badge to use
 * the machine, so the badge is part of the deal. (Whether this specific
 * badge is actually free additionally requires zero active tokens and no
 * badge already in the checkout — decided at purchase time.)
 */
export function isBadgeEligibleFree(user: UserEntity): boolean {
  return !!user.activeMembership || (user.permissions?.length ?? 0) > 0;
}

/** Count a user's active (non-deactivated) tokens from a query snapshot. */
export function countActiveTokens(docs: DocumentSnapshot[]): number {
  return docs.filter((d) => !d.get("deactivated")).length;
}
