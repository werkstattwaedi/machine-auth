// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * The remove (X) affordance on /checkin must:
 *  1. keep the roster anchored to at least one account-linked member — a
 *     walk-in guest can't stand alone, and a user with no family membership
 *     (the only member) can't remove themselves; and
 *  2. look + sit the same whether a person renders as the compact
 *     IdentityStrip (members) or the full PersonCard (guests).
 */

import { afterEach, describe, expect, it, vi } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import { StepCheckin } from "./step-checkin"
import type { CheckoutPerson } from "./use-checkout-state"

afterEach(cleanup)

const self: CheckoutPerson = {
  id: "p-self",
  firstName: "Max",
  lastName: "Muster",
  email: "max@example.com",
  userType: "erwachsen",
  termsAccepted: true,
  isPreFilled: true,
  userId: "u-self",
}
const kid: CheckoutPerson = {
  id: "p-kid",
  firstName: "Kim",
  lastName: "Muster",
  email: "kim@example.com",
  userType: "kind",
  termsAccepted: true,
  isPreFilled: true,
  userId: "u-kid",
}
const guest: CheckoutPerson = {
  id: "p-guest",
  firstName: "",
  lastName: "",
  email: "",
  userType: "erwachsen",
  termsAccepted: false,
  isPreFilled: false,
}

function renderCheckin(persons: CheckoutPerson[]) {
  return render(
    <StepCheckin
      persons={persons}
      personsDispatch={vi.fn()}
      isAnonymous={false}
      kiosk={false}
      isAccountLoggedIn={true}
      signedInUserId="u-self"
      signedInEmail="max@example.com"
      isMember={false}
      onSignOut={vi.fn()}
    />,
  )
}

const removeButtons = () =>
  screen.queryAllByRole("button", { name: /entfernen$/ })

describe("StepCheckin — remove affordance gating (keep ≥1 member)", () => {
  it("shows no remove button when the signed-in user is alone", () => {
    renderCheckin([self])
    expect(removeButtons()).toHaveLength(0)
  })

  it("withholds remove from the only member, even with a guest present", () => {
    // No family membership: self is the only account-linked member, so the
    // checkout must stay anchored to them — they can't remove themselves.
    // The walk-in guest is removable.
    renderCheckin([self, guest])
    expect(
      screen.queryByRole("button", { name: "Person 1 entfernen" }),
    ).toBeNull()
    expect(
      screen.getByRole("button", { name: "Person 2 entfernen" }),
    ).toBeTruthy()
  })

  it("allows removing either member once a second member is present", () => {
    // Family quick-add: two account-linked members → removing one still
    // leaves the checkout anchored, so both carry the X.
    renderCheckin([self, kid])
    expect(
      screen.getByRole("button", { name: "Person 1 entfernen" }),
    ).toBeTruthy()
    expect(
      screen.getByRole("button", { name: "Person 2 entfernen" }),
    ).toBeTruthy()
  })

  it("renders the same remove control for members (strip) and guests (card)", () => {
    // Mixed roster, all removable: the shared RemovePersonButton means the
    // strip's X and the card's X are the identical element (same classes),
    // so they line up instead of sitting in different corners.
    renderCheckin([self, kid, guest])
    const buttons = removeButtons()
    expect(buttons).toHaveLength(3)
    const classes = new Set(buttons.map((b) => b.className))
    expect(classes.size).toBe(1)
  })
})
