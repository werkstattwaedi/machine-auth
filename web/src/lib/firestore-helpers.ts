// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { doc, collection, type DocumentReference } from "firebase/firestore"
import { db } from "./firebase"

export function userRef(id: string): DocumentReference {
  return doc(db, "users", id)
}

export function machineRef(id: string): DocumentReference {
  return doc(db, "machine", id)
}

export function permissionRef(id: string): DocumentReference {
  return doc(db, "permission", id)
}

export function tokenRef(id: string): DocumentReference {
  return doc(db, "tokens", id)
}

export function macoRef(id: string): DocumentReference {
  return doc(db, "maco", id)
}

export function catalogRef(id: string): DocumentReference {
  return doc(db, "catalog", id)
}

export function usageMachineRef(id: string): DocumentReference {
  return doc(db, "usage_machine", id)
}

export function checkoutRef(id: string): DocumentReference {
  return doc(db, "checkouts", id)
}

export function checkoutItemRef(checkoutId: string, itemId: string): DocumentReference {
  return doc(db, "checkouts", checkoutId, "items", itemId)
}

export function checkoutItemsCollection(checkoutId: string) {
  return collection(db, "checkouts", checkoutId, "items")
}

export function configRef(id: string): DocumentReference {
  return doc(db, "config", id)
}

/** Extract the document ID from a DocumentReference or path string */
export function refId(ref: DocumentReference | { id: string } | string): string {
  if (typeof ref === "string") return ref.split("/").pop() ?? ref
  return ref.id
}
