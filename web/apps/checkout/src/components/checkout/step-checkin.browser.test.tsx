// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { render, screen, cleanup } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, it, expect, afterEach, vi } from "vitest"
import { useReducer } from "react"
import { StepCheckin } from "./step-checkin"
import {
  checkoutReducer,
  initialState,
  type CheckoutState,
  type CheckoutAction,
} from "./use-checkout-state"

afterEach(cleanup)

/**
 * Wrapper that provides a real reducer so dispatch actually updates state.
 * Captures dispatched actions for assertions.
 */
function renderCheckin({
  isAnonymous = true,
  kiosk = false,
  isAccountLoggedIn = false,
  stateOverrides,
}: {
  isAnonymous?: boolean
  kiosk?: boolean
  isAccountLoggedIn?: boolean
  stateOverrides?: Partial<CheckoutState>
} = {}) {
  const dispatched: CheckoutAction[] = []
  const onSignOut = vi.fn()

  function Wrapper() {
    const init = { ...initialState, ...stateOverrides }
    const [state, dispatch] = useReducer(checkoutReducer, init)
    const wrappedDispatch = (action: CheckoutAction) => {
      dispatched.push(action)
      dispatch(action)
    }
    return (
      <StepCheckin
        state={state}
        dispatch={wrappedDispatch}
        isAnonymous={isAnonymous}
        kiosk={kiosk}
        isAccountLoggedIn={isAccountLoggedIn}
        onSignOut={onSignOut}
      />
    )
  }

  render(<Wrapper />)
  return { dispatched, onSignOut }
}

describe("StepCheckin validation", () => {
  it("shows errors when Weiter is clicked with empty fields", async () => {
    const user = userEvent.setup()
    const { dispatched } = renderCheckin()

    await user.click(screen.getByRole("button", { name: /Weiter/ }))

    // Errors visible
    expect(screen.getByText("Vorname ist erforderlich.")).toBeTruthy()
    expect(screen.getByText("Nachname ist erforderlich.")).toBeTruthy()
    expect(screen.getByText("E-Mail ist erforderlich.")).toBeTruthy()
    expect(screen.getByText("Nutzungsbestimmungen ist erforderlich.")).toBeTruthy()

    // Step not advanced
    expect(dispatched.find((a) => a.type === "SET_STEP")).toBeUndefined()
  })

  it("shows email format error for invalid email", async () => {
    const user = userEvent.setup()
    renderCheckin()

    // Fill fields but with bad email
    const inputs = screen.getAllByRole("textbox")
    // inputs: firstName, lastName, email (textbox type)
    await user.type(inputs[0], "Max")
    await user.type(inputs[1], "Muster")

    await user.type(inputs[2], "not-valid")
    await user.tab() // blur

    // Click Weiter to trigger submitted state
    await user.click(screen.getByRole("button", { name: /Weiter/ }))

    expect(
      screen.getByText("E-Mail muss im Format name@address.xyz eingegeben werden."),
    ).toBeTruthy()
  })

  it("shows error on blur for touched fields", async () => {
    const user = userEvent.setup()
    renderCheckin()

    // Focus and blur firstName without typing
    const inputs = screen.getAllByRole("textbox")
    await user.click(inputs[0])
    await user.tab()

    // Error should appear because field was touched
    expect(screen.getByText("Vorname ist erforderlich.")).toBeTruthy()
  })

  it("clears error when field is corrected", async () => {
    const user = userEvent.setup()
    renderCheckin()

    // Trigger errors
    await user.click(screen.getByRole("button", { name: /Weiter/ }))
    expect(screen.getByText("Vorname ist erforderlich.")).toBeTruthy()

    // Fix firstName
    const inputs = screen.getAllByRole("textbox")
    await user.type(inputs[0], "Max")

    // Error should be gone
    expect(screen.queryByText("Vorname ist erforderlich.")).toBeNull()
  })

  it("advances when all fields are valid", async () => {
    const user = userEvent.setup()
    const { dispatched } = renderCheckin()

    const inputs = screen.getAllByRole("textbox")
    await user.type(inputs[0], "Max")
    await user.type(inputs[1], "Muster")

    const emailInput = inputs[2]
    await user.type(emailInput, "max@test.com")

    // Accept terms
    await user.click(screen.getByRole("checkbox"))

    // Click Weiter
    await user.click(screen.getByRole("button", { name: /Weiter/ }))

    expect(dispatched).toContainEqual({ type: "SET_STEP", step: 1 })
  })

  it("Weiter button is always enabled (not disabled)", () => {
    renderCheckin()
    const btn = screen.getByRole("button", { name: /Weiter/ })
    expect(btn).not.toBeDisabled()
  })

  it("does not require terms for non-anonymous users", async () => {
    const user = userEvent.setup()
    const { dispatched } = renderCheckin({ isAnonymous: false })

    const inputs = screen.getAllByRole("textbox")
    await user.type(inputs[0], "Max")
    await user.type(inputs[1], "Muster")
    await user.type(inputs[2], "max@test.com")

    await user.click(screen.getByRole("button", { name: /Weiter/ }))

    expect(dispatched).toContainEqual({ type: "SET_STEP", step: 1 })
  })

  it("newly added person does not show errors immediately after prior submit", async () => {
    const user = userEvent.setup()
    renderCheckin()

    // Click Weiter with empty first person → errors shown
    await user.click(screen.getByRole("button", { name: /Weiter/ }))
    expect(screen.getByText("Vorname ist erforderlich.")).toBeTruthy()

    // Add a second person — resets submitted, clears submit-triggered errors
    await user.click(screen.getByRole("button", { name: /Person hinzufügen/ }))

    // No submit-triggered errors visible (submitted was reset)
    expect(screen.queryByText("Vorname ist erforderlich.")).toBeNull()
  })
})

describe("Identity hint", () => {
  it("shows login hint for anonymous browser users", () => {
    renderCheckin({ isAnonymous: true, kiosk: false })

    expect(screen.getByText("Bereits registriert oder Konto erstellen?")).toBeTruthy()
    expect(screen.getByText("Anmelden")).toBeTruthy()
  })

  it("shows NFC hint for kiosk mode", () => {
    renderCheckin({ isAnonymous: true, kiosk: true })

    expect(
      screen.getByText("Badge an den Leser halten, um deine Daten zu laden"),
    ).toBeTruthy()
    expect(screen.queryByText("Bereits registriert oder Konto erstellen?")).toBeNull()
  })

  it("shows sign-out in person card for logged-in users", () => {
    renderCheckin({
      isAnonymous: false,
      isAccountLoggedIn: true,

      stateOverrides: {
        persons: [{
          id: "p1",
          firstName: "Max",
          lastName: "Muster",
          email: "max@test.com",
          userType: "erwachsen",
          termsAccepted: true,
          isPreFilled: true,
        }],
      },
    })

    expect(screen.queryByText("Bereits registriert oder Konto erstellen?")).toBeNull()
    expect(screen.getByText(/Abmelden/)).toBeTruthy()
  })

  it("calls onSignOut when Abmelden is clicked", async () => {
    const user = userEvent.setup()
    const { onSignOut } = renderCheckin({
      isAnonymous: false,
      isAccountLoggedIn: true,

      stateOverrides: {
        persons: [{
          id: "p1",
          firstName: "Max",
          lastName: "Muster",
          email: "max@test.com",
          userType: "erwachsen",
          termsAccepted: true,
          isPreFilled: true,
        }],
      },
    })

    await user.click(screen.getByText(/Abmelden/))
    expect(onSignOut).toHaveBeenCalledOnce()
  })

  it("hides identity hint when tag-identified (not anonymous, not account)", () => {
    renderCheckin({ isAnonymous: false, isAccountLoggedIn: false })

    expect(screen.queryByText("Bereits registriert oder Konto erstellen?")).toBeNull()
    expect(screen.queryByText("Badge an den Leser halten")).toBeNull()
  })
})
