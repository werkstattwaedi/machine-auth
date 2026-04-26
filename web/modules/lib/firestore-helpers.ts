// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Canonical typed builders for every Firestore reference the web apps
 * touch. New code MUST go through these — string-path Firestore access
 * is no longer allowed (see ADR-0011 and CLAUDE.md).
 *
 * Each builder returns a `DocumentReference<T>` / `CollectionReference<T>`
 * narrowed to the matching `*Doc` interface from `firestore-entities.ts`.
 * No Firestore `withConverter` is attached — runtime data already matches
 * the wire shape; the generic only exists to give the React hooks and the
 * `useFirestoreMutation` API real type inference.
 */

import {
  collection,
  doc,
  type CollectionReference,
  type DocumentReference,
  type Firestore,
} from "firebase/firestore"

import type {
  AuditLogDoc,
  BillDoc,
  CatalogItemDoc,
  CheckoutDoc,
  CheckoutItemDoc,
  ConfigDoc,
  MachineDoc,
  MacoDoc,
  OperationsLogDoc,
  PermissionDoc,
  PriceListDoc,
  TokenDoc,
  UsageMachineDoc,
  UserDoc,
} from "./firestore-entities"

// ── users ────────────────────────────────────────────────────────────────

export function usersCollection(db: Firestore): CollectionReference<UserDoc> {
  return collection(db, "users") as CollectionReference<UserDoc>
}

export function userRef(db: Firestore, id: string): DocumentReference<UserDoc> {
  return doc(db, "users", id) as DocumentReference<UserDoc>
}

// ── machine ──────────────────────────────────────────────────────────────

export function machinesCollection(
  db: Firestore,
): CollectionReference<MachineDoc> {
  return collection(db, "machine") as CollectionReference<MachineDoc>
}

export function machineRef(
  db: Firestore,
  id: string,
): DocumentReference<MachineDoc> {
  return doc(db, "machine", id) as DocumentReference<MachineDoc>
}

// ── permission ───────────────────────────────────────────────────────────

export function permissionsCollection(
  db: Firestore,
): CollectionReference<PermissionDoc> {
  return collection(db, "permission") as CollectionReference<PermissionDoc>
}

export function permissionRef(
  db: Firestore,
  id: string,
): DocumentReference<PermissionDoc> {
  return doc(db, "permission", id) as DocumentReference<PermissionDoc>
}

// ── tokens ───────────────────────────────────────────────────────────────

export function tokensCollection(
  db: Firestore,
): CollectionReference<TokenDoc> {
  return collection(db, "tokens") as CollectionReference<TokenDoc>
}

export function tokenRef(
  db: Firestore,
  id: string,
): DocumentReference<TokenDoc> {
  return doc(db, "tokens", id) as DocumentReference<TokenDoc>
}

// ── maco ─────────────────────────────────────────────────────────────────

export function macosCollection(db: Firestore): CollectionReference<MacoDoc> {
  return collection(db, "maco") as CollectionReference<MacoDoc>
}

export function macoRef(
  db: Firestore,
  id: string,
): DocumentReference<MacoDoc> {
  return doc(db, "maco", id) as DocumentReference<MacoDoc>
}

// ── catalog ──────────────────────────────────────────────────────────────

export function catalogCollection(
  db: Firestore,
): CollectionReference<CatalogItemDoc> {
  return collection(db, "catalog") as CollectionReference<CatalogItemDoc>
}

export function catalogRef(
  db: Firestore,
  id: string,
): DocumentReference<CatalogItemDoc> {
  return doc(db, "catalog", id) as DocumentReference<CatalogItemDoc>
}

// ── price_lists ──────────────────────────────────────────────────────────

export function priceListsCollection(
  db: Firestore,
): CollectionReference<PriceListDoc> {
  return collection(db, "price_lists") as CollectionReference<PriceListDoc>
}

export function priceListRef(
  db: Firestore,
  id: string,
): DocumentReference<PriceListDoc> {
  return doc(db, "price_lists", id) as DocumentReference<PriceListDoc>
}

// ── usage_machine ────────────────────────────────────────────────────────

export function usageMachineCollection(
  db: Firestore,
): CollectionReference<UsageMachineDoc> {
  return collection(db, "usage_machine") as CollectionReference<UsageMachineDoc>
}

export function usageMachineRef(
  db: Firestore,
  id: string,
): DocumentReference<UsageMachineDoc> {
  return doc(db, "usage_machine", id) as DocumentReference<UsageMachineDoc>
}

// ── checkouts ────────────────────────────────────────────────────────────

export function checkoutsCollection(
  db: Firestore,
): CollectionReference<CheckoutDoc> {
  return collection(db, "checkouts") as CollectionReference<CheckoutDoc>
}

export function checkoutRef(
  db: Firestore,
  id: string,
): DocumentReference<CheckoutDoc> {
  return doc(db, "checkouts", id) as DocumentReference<CheckoutDoc>
}

export function checkoutItemsCollection(
  db: Firestore,
  checkoutId: string,
): CollectionReference<CheckoutItemDoc> {
  return collection(
    db,
    "checkouts",
    checkoutId,
    "items",
  ) as CollectionReference<CheckoutItemDoc>
}

export function checkoutItemRef(
  db: Firestore,
  checkoutId: string,
  itemId: string,
): DocumentReference<CheckoutItemDoc> {
  return doc(
    db,
    "checkouts",
    checkoutId,
    "items",
    itemId,
  ) as DocumentReference<CheckoutItemDoc>
}

// ── bills ────────────────────────────────────────────────────────────────

export function billsCollection(db: Firestore): CollectionReference<BillDoc> {
  return collection(db, "bills") as CollectionReference<BillDoc>
}

export function billRef(
  db: Firestore,
  id: string,
): DocumentReference<BillDoc> {
  return doc(db, "bills", id) as DocumentReference<BillDoc>
}

// ── config ───────────────────────────────────────────────────────────────

export function configCollection(
  db: Firestore,
): CollectionReference<ConfigDoc> {
  return collection(db, "config") as CollectionReference<ConfigDoc>
}

export function configRef(
  db: Firestore,
  id: string,
): DocumentReference<ConfigDoc> {
  return doc(db, "config", id) as DocumentReference<ConfigDoc>
}

// ── audit_log ────────────────────────────────────────────────────────────

export function auditLogCollection(
  db: Firestore,
): CollectionReference<AuditLogDoc> {
  return collection(db, "audit_log") as CollectionReference<AuditLogDoc>
}

// ── operations_log ───────────────────────────────────────────────────────

export function operationsLogCollection(
  db: Firestore,
): CollectionReference<OperationsLogDoc> {
  return collection(db, "operations_log") as CollectionReference<OperationsLogDoc>
}

// ── helpers ──────────────────────────────────────────────────────────────

/** Extract the document ID from a DocumentReference or path string. */
export function refId(
  ref: DocumentReference | { id: string } | string,
): string {
  if (typeof ref === "string") return ref.split("/").pop() ?? ref
  return ref.id
}
