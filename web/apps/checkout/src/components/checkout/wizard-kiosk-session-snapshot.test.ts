// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Issues #769/#752: after the commit (CHK-22) the wizard still holds the
 * visit's persons, which `hasPreservableState` alone counts as worth keeping
 * — so a second badge on the confirmation page asked "Benutzer wechseln?"
 * (or offered to discard a guest's already-closed checkout). The snapshot the
 * wizard hands BridgeNfcRouter must report nothing preservable once the
 * checkout is committed, for one person, several persons and a typed guest.
 */

import { describe, expect, it } from "vitest"
import { kioskSessionSnapshot } from "./wizard-context"
import type { CheckoutPerson } from "./use-checkout-state"

function person(overrides: Partial<CheckoutPerson> = {}): CheckoutPerson {
  return {
    id: "u1",
    firstName: "Max",
    lastName: "Muster",
    email: "max@example.com",
    userType: "erwachsen",
    termsAccepted: true,
    isPreFilled: true,
    userId: "u1",
    usageType: "regular",
    ...overrides,
  }
}

const child = person({
  id: "p2",
  firstName: "Mia",
  email: "",
  userType: "kind",
  isPreFilled: false,
  userId: undefined,
})

const typedGuest = person({ id: "p1", isPreFilled: false, userId: undefined })

// What the wizard holds on the confirmation page: the open checkout is gone
// (closed), the cart is cleared, the persons remain.
function afterSubmit(
  persons: CheckoutPerson[],
  overrides: { identified?: boolean; committed?: boolean } = {},
) {
  return {
    openCheckout: null,
    checkoutId: "co-1",
    pendingCheckout: false,
    items: [],
    persons,
    identified: overrides.identified ?? true,
    committed: overrides.committed ?? true,
    holderName: "Max Muster",
    badgeTokenIds: [],
    paymentInProgress: false,
  }
}

describe("kioskSessionSnapshot after submitCheckout", () => {
  it.each([
    ["one person", [person()], true],
    ["several persons", [person(), child], true],
    ["a typed guest", [typedGuest], false],
  ])("%s: nothing preservable once committed", (_, persons, identified) => {
    const snapshot = kioskSessionSnapshot(afterSubmit(persons, { identified }))
    expect(snapshot.preservable).toBe(false)
    expect(snapshot.committed).toBe(true)
    expect(snapshot.identified).toBe(identified)
  })

  it.each([
    ["several persons", [person(), child], true],
    ["a typed guest", [typedGuest], false],
  ])("%s: still preservable before the commit", (_, persons, identified) => {
    const snapshot = kioskSessionSnapshot(
      afterSubmit(persons, { identified, committed: false }),
    )
    expect(snapshot.preservable).toBe(true)
  })
})
