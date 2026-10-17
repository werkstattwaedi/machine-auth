// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * The remove (X) affordance on /checkin must:
 *  1. never remove the owner (the signed-in user) from their own visit
 *     (ADR-0048) — everyone else is removable down to one person; and
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
  usageType: "regular",
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
  usageType: "regular",
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
  usageType: "regular",
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
    />,
  )
}

const removeButtons = () =>
  screen.queryAllByRole("button", { name: /entfernen$/ })

describe("StepCheckin — remove affordance gating (owner stays)", () => {
  it("shows no remove button when the signed-in user is alone", () => {
    renderCheckin([self])
    expect(removeButtons()).toHaveLength(0)
  })

  it("withholds remove from the owner, even with a guest present", () => {
    renderCheckin([self, guest])
    expect(
      screen.queryByRole("button", { name: "Person 1 entfernen" }),
    ).toBeNull()
    expect(
      screen.getByRole("button", { name: "Person 2 entfernen" }),
    ).toBeTruthy()
  })

  it("lets a legacy family-roster line go, but never the owner", () => {
    // An open checkout from before ADR-0048 may carry a family member's
    // userId — removable like any guest.
    renderCheckin([self, kid])
    expect(
      screen.queryByRole("button", { name: "Person 1 entfernen" }),
    ).toBeNull()
    expect(
      screen.getByRole("button", { name: "Person 2 entfernen" }),
    ).toBeTruthy()
  })

  it("renders the same remove control for strips and guest cards", () => {
    // The shared RemovePersonButton means the strip's X and the card's X are
    // the identical element (same classes), so they line up instead of
    // sitting in different corners.
    renderCheckin([self, kid, guest])
    const buttons = removeButtons()
    expect(buttons).toHaveLength(2)
    const classes = new Set(buttons.map((b) => b.className))
    expect(classes.size).toBe(1)
  })
})
