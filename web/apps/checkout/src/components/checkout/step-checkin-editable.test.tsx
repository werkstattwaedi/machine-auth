// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Anon walk-ins must stay editable on /checkin even when their roster is
 * rehydrated from the open checkout (isPreFilled). Identity-linked pre-fills
 * (tag-tap, signed-in) stay read-only. The decision is `editable={isAnonymous}`
 * passed to PersonCard.
 */

import { afterEach, describe, expect, it, vi } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import { StepCheckin } from "./step-checkin"
import type { CheckoutPerson } from "./use-checkout-state"

afterEach(cleanup)

const prefilled: CheckoutPerson = {
  id: "p1",
  firstName: "Max",
  lastName: "Muster",
  email: "max@example.com",
  userType: "erwachsen",
  termsAccepted: true,
  isPreFilled: true,
  userId: null,
}

function renderCheckin(isAnonymous: boolean) {
  return render(
    <StepCheckin
      persons={[prefilled]}
      personsDispatch={vi.fn()}
      isAnonymous={isAnonymous}
      kiosk={false}
      isAccountLoggedIn={false}
      signedInUserId={null}
      signedInEmail={null}
      isMember={false}
      onSignOut={vi.fn()}
    />,
  )
}

describe("StepCheckin — editable anon person", () => {
  it("renders editable inputs for an anonymous pre-filled person", () => {
    renderCheckin(true)
    // Editable → the value lives in an <input>, not read-only <p> text.
    expect(screen.getByDisplayValue("Max")).toBeTruthy()
    expect(screen.getByDisplayValue("Muster")).toBeTruthy()
    expect(screen.queryByText("Max")).toBeNull()
  })

  it("keeps a tag-identified pre-filled person read-only", () => {
    // isAnonymous=false + not signed in == tag-tap → read-only PersonCard.
    renderCheckin(false)
    expect(screen.getByText("Max")).toBeTruthy()
    expect(screen.queryByDisplayValue("Max")).toBeNull()
  })
})
