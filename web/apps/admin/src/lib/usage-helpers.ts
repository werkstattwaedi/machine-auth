// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import type { DocumentReference } from "firebase/firestore"

/**
 * A usage's `checkoutItemRef` points at /checkouts/{id}/items/{itemId};
 * the grandparent doc id is the Besuch (checkout) the usage was billed
 * under. Returns null for unbilled usages.
 */
export function usageCheckoutId(
  ref: DocumentReference | null | undefined,
): string | null {
  if (!ref) return null
  return (
    (ref as { parent?: { parent?: { id?: string } } }).parent?.parent?.id ??
    null
  )
}
