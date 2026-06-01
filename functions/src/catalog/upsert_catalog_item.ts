// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";

/**
 * Catalog `code` uniqueness is enforced here, not by Firestore rules.
 * Rules can't run a query to check for duplicates, so admin clients call
 * this callable instead of writing `catalog/...` directly; the matching
 * `firestore.rules` block denies client-side writes to `catalog`. Reads
 * stay open (the checkout picker queries the collection directly).
 *
 * Codes stay as a field — not a doc ID — so renames remain a cheap
 * field update instead of a doc-id migration touching `priceLists.items`
 * and every historical `checkoutItems.catalogId` reference.
 */

interface CatalogVariantInput {
  id: string;
  label?: string | null;
  pricingModel: string;
  unitPrice: { default: number; member?: number };
}

interface UpsertCatalogItemRequest {
  /** Doc id when updating an existing entry; omit / null when creating. */
  id?: string | null;
  code: string;
  name: string;
  description?: string | null;
  workshops: string[];
  /**
   * Optional on update — the admin form doesn't edit category yet, so
   * an absent value means "preserve existing". On create, falls back
   * to ["Sonstiges"] to keep the existing create-dialog default.
   */
  category?: string[];
  active: boolean;
  userCanAdd: boolean;
  variants: CatalogVariantInput[];
}

function assertString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new HttpsError("invalid-argument", `${field} must be a non-empty string`);
  }
  return value;
}

function assertStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
    throw new HttpsError("invalid-argument", `${field} must be an array of strings`);
  }
  return value as string[];
}

function assertVariants(value: unknown): CatalogVariantInput[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new HttpsError("invalid-argument", "variants must be a non-empty array");
  }
  for (const v of value) {
    if (typeof v !== "object" || v === null) {
      throw new HttpsError("invalid-argument", "variants entries must be objects");
    }
    const obj = v as Record<string, unknown>;
    assertString(obj.id, "variant.id");
    assertString(obj.pricingModel, "variant.pricingModel");
    if (typeof obj.unitPrice !== "object" || obj.unitPrice === null) {
      throw new HttpsError("invalid-argument", "variant.unitPrice must be an object");
    }
    const up = obj.unitPrice as Record<string, unknown>;
    if (typeof up.default !== "number") {
      throw new HttpsError("invalid-argument", "variant.unitPrice.default must be a number");
    }
    if (up.member !== undefined && typeof up.member !== "number") {
      throw new HttpsError("invalid-argument", "variant.unitPrice.member must be a number");
    }
  }
  return value as CatalogVariantInput[];
}

function parseRequest(raw: unknown): UpsertCatalogItemRequest {
  if (typeof raw !== "object" || raw === null) {
    throw new HttpsError("invalid-argument", "request body must be an object");
  }
  const data = raw as Record<string, unknown>;
  const id =
    typeof data.id === "string" && data.id.length > 0 ? data.id : null;
  const description =
    typeof data.description === "string" ? data.description : null;
  if (typeof data.active !== "boolean") {
    throw new HttpsError("invalid-argument", "active must be a boolean");
  }
  if (typeof data.userCanAdd !== "boolean") {
    throw new HttpsError("invalid-argument", "userCanAdd must be a boolean");
  }
  const category =
    data.category === undefined
      ? undefined
      : assertStringArray(data.category, "category");
  return {
    id,
    code: assertString(data.code, "code"),
    name: assertString(data.name, "name"),
    description,
    workshops: assertStringArray(data.workshops, "workshops"),
    category,
    active: data.active,
    userCanAdd: data.userCanAdd,
    variants: assertVariants(data.variants),
  };
}

/**
 * Pure handler — split from the `onCall` wrapper so integration tests
 * can drive it directly without going through callable transport.
 * `actorUid` is recorded in `modifiedBy`; null when an unauthenticated
 * test path is exercised (callers should still gate on auth above).
 */
export async function handleUpsertCatalogItem(
  data: unknown,
  actorUid: string | null
): Promise<{ id: string }> {
  const input = parseRequest(data);
  const db = getFirestore();
  const collection = db.collection("catalog");
  // Stable target ref: a new ref for create (so the transaction can
  // reserve the id), or the supplied id for update.
  const targetRef = input.id
    ? collection.doc(input.id)
    : collection.doc();

  await db.runTransaction(async (tx) => {
    // Read-before-write: check for any other catalog doc with this code.
    // Limit 2 so we always have evidence of the offender (and never
    // need to scan the whole catalog).
    const dupes = await tx.get(
      collection.where("code", "==", input.code).limit(2)
    );
    for (const doc of dupes.docs) {
      if (doc.id !== targetRef.id) {
        throw new HttpsError(
          "already-exists",
          `Code "${input.code}" is already used by another catalog entry.`
        );
      }
    }

    // For update flow, also verify the doc exists (so we don't silently
    // create a doc at a caller-supplied id that doesn't match anything).
    if (input.id) {
      const existing = await tx.get(targetRef);
      if (!existing.exists) {
        throw new HttpsError(
          "not-found",
          `Catalog entry "${input.id}" not found`
        );
      }
    }

    // Category defaults to ["Sonstiges"] on create (matches the
    // legacy create-dialog default); on update, an undefined category
    // means "keep what's already there".
    const isCreate = !input.id;
    const resolvedCategory =
      input.category ?? (isCreate ? ["Sonstiges"] : undefined);
    const docData: Record<string, unknown> = {
      code: input.code,
      name: input.name,
      description: input.description,
      workshops: input.workshops,
      active: input.active,
      userCanAdd: input.userCanAdd,
      variants: input.variants,
      modifiedBy: actorUid,
      modifiedAt: new Date(),
    };
    if (resolvedCategory !== undefined) {
      docData.category = resolvedCategory;
    }
    // Create: full write so the doc has a known shape.
    // Update: merge so callers don't have to round-trip every field
    // they don't edit (e.g. the admin form doesn't touch category).
    tx.set(targetRef, docData, { merge: !isCreate });
  });

  return { id: targetRef.id };
}

export const upsertCatalogItemHandler = async (request: CallableRequest<unknown>) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentication required");
    }
    if (request.auth.token.admin !== true) {
      throw new HttpsError("permission-denied", "Admin role required");
    }
    return handleUpsertCatalogItem(request.data, request.auth.uid);
  };
