// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { doc, collection, type DocumentReference, type Firestore } from "firebase/firestore"

export function userRef(db: Firestore, id: string): DocumentReference {
  return doc(db, "users", id)
}

export function machineRef(db: Firestore, id: string): DocumentReference {
  return doc(db, "machine", id)
}

export function permissionRef(db: Firestore, id: string): DocumentReference {
  return doc(db, "permission", id)
}

export function tokenRef(db: Firestore, id: string): DocumentReference {
  return doc(db, "tokens", id)
}

export function macoRef(db: Firestore, id: string): DocumentReference {
  return doc(db, "maco", id)
}

export function catalogRef(db: Firestore, id: string): DocumentReference {
  return doc(db, "catalog", id)
}

export function usageMachineRef(db: Firestore, id: string): DocumentReference {
  return doc(db, "usage_machine", id)
}

export function checkoutRef(db: Firestore, id: string): DocumentReference {
  return doc(db, "checkouts", id)
}

export function checkoutItemRef(db: Firestore, checkoutId: string, itemId: string): DocumentReference {
  return doc(db, "checkouts", checkoutId, "items", itemId)
}

export function checkoutItemsCollection(db: Firestore, checkoutId: string) {
  return collection(db, "checkouts", checkoutId, "items")
}

export function configRef(db: Firestore, id: string): DocumentReference {
  return doc(db, "config", id)
}

/** Extract the document ID from a DocumentReference or path string */
export function refId(ref: DocumentReference | { id: string } | string): string {
  if (typeof ref === "string") return ref.split("/").pop() ?? ref
  return ref.id
}
