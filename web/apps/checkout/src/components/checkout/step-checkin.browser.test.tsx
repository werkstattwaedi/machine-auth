// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { render, screen, cleanup } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, it, expect, afterEach, vi } from "vitest"
import { useReducer } from "react"
import { StepCheckin, type FamilyCandidate } from "./step-checkin"
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
  onAdvance,
  familyCandidates,
}: {
  isAnonymous?: boolean
  kiosk?: boolean
  isAccountLoggedIn?: boolean
  stateOverrides?: Partial<CheckoutState>
  onAdvance?: () => Promise<void>
  familyCandidates?: FamilyCandidate[]
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
        onAdvance={onAdvance}
        familyCandidates={familyCandidates}
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

  // Issue #151 regression: anonymous sign-in must run BEFORE the
  // step transition so step 2 can write to Firestore as a real principal.
  // If we dispatched SET_STEP first, step-workshops.tsx would mount and
  // try to addDoc against `checkouts` while still unauthenticated — the
  // rule for anon-userId checkouts requires `isAnonymousAuth()`.
  describe("eager anonymous sign-in (#151)", () => {
    it("calls onAdvance before dispatching SET_STEP", async () => {
      const user = userEvent.setup()
      const order: string[] = []
      const onAdvance = vi.fn(async () => {
        order.push("onAdvance")
      })

      const { dispatched } = renderCheckin({ isAnonymous: true, onAdvance })

      // Capture dispatch order via a side-effect on the array reference.
      const originalPush = dispatched.push.bind(dispatched)
      dispatched.push = (...items: CheckoutAction[]) => {
        for (const item of items) {
          if (item.type === "SET_STEP") order.push("SET_STEP")
        }
        return originalPush(...items)
      }

      // Fill valid form
      const inputs = screen.getAllByRole("textbox")
      await user.type(inputs[0], "Max")
      await user.type(inputs[1], "Muster")
      await user.type(inputs[2], "max@test.com")
      await user.click(screen.getByRole("checkbox"))

      await user.click(screen.getByRole("button", { name: /Weiter/ }))

      expect(onAdvance).toHaveBeenCalledOnce()
      expect(order).toEqual(["onAdvance", "SET_STEP"])
    })

    it("does NOT call onAdvance or advance when validation fails", async () => {
      const user = userEvent.setup()
      const onAdvance = vi.fn(async () => {})
      const { dispatched } = renderCheckin({ isAnonymous: true, onAdvance })

      // Click Weiter with empty form → errors shown, onAdvance not called
      await user.click(screen.getByRole("button", { name: /Weiter/ }))

      expect(onAdvance).not.toHaveBeenCalled()
      expect(dispatched.find((a) => a.type === "SET_STEP")).toBeUndefined()
    })

    it("does not advance if onAdvance throws (sign-in failure)", async () => {
      const user = userEvent.setup()
      const onAdvance = vi.fn(async () => {
        throw new Error("network down")
      })
      const { dispatched } = renderCheckin({ isAnonymous: true, onAdvance })

      const inputs = screen.getAllByRole("textbox")
      await user.type(inputs[0], "Max")
      await user.type(inputs[1], "Muster")
      await user.type(inputs[2], "max@test.com")
      await user.click(screen.getByRole("checkbox"))

      // The button click rejects; user-event surfaces the rejection but the
      // assertion afterwards is what matters.
      await user
        .click(screen.getByRole("button", { name: /Weiter/ }))
        .catch(() => {})

      expect(onAdvance).toHaveBeenCalledOnce()
      // Crucially: SET_STEP was NOT dispatched.
      expect(dispatched.find((a) => a.type === "SET_STEP")).toBeUndefined()
    })
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

// Issue #209: family-roster quick-add buttons & first-card removal.
describe("Family-roster quick-add (#209)", () => {
  const ownerPrimary: CheckoutState["persons"][number] = {
    id: "p-self",
    firstName: "Max",
    lastName: "Muster",
    email: "max@example.com",
    userType: "erwachsen",
    termsAccepted: true,
    isPreFilled: true,
    userId: "u-self",
  }
  const candidates: FamilyCandidate[] = [
    {
      userId: "u-lia",
      firstName: "Lia",
      lastName: "Pfeffer",
      email: "lia@example.com",
      userType: "kind",
    },
    {
      userId: "u-yvonne",
      firstName: "Yvonne",
      lastName: "Pfeiffer",
      email: "yvonne@example.com",
      userType: "erwachsen",
    },
  ]

  it("renders one quick-add button per family candidate", () => {
    renderCheckin({
      isAnonymous: false,
      isAccountLoggedIn: true,
      stateOverrides: { persons: [ownerPrimary] },
      familyCandidates: candidates,
    })

    expect(screen.getByRole("button", { name: /Lia Pfeffer/ })).toBeTruthy()
    expect(screen.getByRole("button", { name: /Yvonne Pfeiffer/ })).toBeTruthy()
  })

  it("renders no quick-add buttons when familyCandidates is empty / undefined", () => {
    renderCheckin({
      isAnonymous: false,
      isAccountLoggedIn: true,
      stateOverrides: { persons: [ownerPrimary] },
      familyCandidates: [],
    })
    expect(screen.queryByRole("button", { name: /Pfeffer/ })).toBeNull()
    expect(screen.queryByRole("button", { name: /Pfeiffer/ })).toBeNull()
  })

  it("dispatches ADD_FAMILY_PERSON when a quick-add button is clicked", async () => {
    const user = userEvent.setup()
    const { dispatched } = renderCheckin({
      isAnonymous: false,
      isAccountLoggedIn: true,
      stateOverrides: { persons: [ownerPrimary] },
      familyCandidates: candidates,
    })

    await user.click(screen.getByRole("button", { name: /Lia Pfeffer/ }))

    const action = dispatched.find((a) => a.type === "ADD_FAMILY_PERSON")
    expect(action).toBeDefined()
    expect(action).toMatchObject({
      type: "ADD_FAMILY_PERSON",
      person: {
        userId: "u-lia",
        firstName: "Lia",
        lastName: "Pfeffer",
        email: "lia@example.com",
        userType: "kind",
      },
    })
  })

  it("only shows candidates not already on the visit (caller-side filter)", () => {
    // The wizard filters out members already attached via `userId`. We
    // emulate the filtered list and assert that the rendered set matches.
    const remaining = candidates.filter((c) => c.userId !== "u-yvonne")
    renderCheckin({
      isAnonymous: false,
      isAccountLoggedIn: true,
      stateOverrides: {
        persons: [
          ownerPrimary,
          {
            id: "p-yvonne",
            firstName: "Yvonne",
            lastName: "Pfeiffer",
            email: "yvonne@example.com",
            userType: "erwachsen",
            termsAccepted: true,
            isPreFilled: true,
            userId: "u-yvonne",
          },
        ],
      },
      familyCandidates: remaining,
    })

    expect(screen.getByRole("button", { name: /Lia Pfeffer/ })).toBeTruthy()
    expect(screen.queryByRole("button", { name: /\+ Yvonne Pfeiffer/ })).toBeNull()
  })
})

// Issue #209: any card (incl. the pre-filled / first card) can be removed
// when ≥ 2 persons are on the visit. The `isOnly` guard still pins at
// least one person.
describe("Person removal (#209)", () => {
  const preFilled: CheckoutState["persons"][number] = {
    id: "p-self",
    firstName: "Max",
    lastName: "Muster",
    email: "max@example.com",
    userType: "erwachsen",
    termsAccepted: true,
    isPreFilled: true,
    userId: "u-self",
  }
  const familyMember: CheckoutState["persons"][number] = {
    id: "p-lia",
    firstName: "Lia",
    lastName: "Pfeffer",
    email: "lia@example.com",
    userType: "kind",
    termsAccepted: true,
    isPreFilled: true,
    userId: "u-lia",
  }

  it("does NOT show the X button when only one person is on the visit", () => {
    renderCheckin({
      isAnonymous: false,
      isAccountLoggedIn: true,
      stateOverrides: { persons: [preFilled] },
    })
    expect(screen.queryByRole("button", { name: /Person 1 entfernen/ })).toBeNull()
  })

  it("shows the X button on the pre-filled first card when ≥ 2 persons are on the visit", () => {
    renderCheckin({
      isAnonymous: false,
      isAccountLoggedIn: true,
      stateOverrides: { persons: [preFilled, familyMember] },
    })
    // First card (the pre-filled / signed-in user) is now removable too.
    expect(screen.getByRole("button", { name: /Person 1 entfernen/ })).toBeTruthy()
  })

  it("removes the pre-filled first card when the X button is clicked", async () => {
    const user = userEvent.setup()
    const { dispatched } = renderCheckin({
      isAnonymous: false,
      isAccountLoggedIn: true,
      stateOverrides: { persons: [preFilled, familyMember] },
    })

    await user.click(screen.getByRole("button", { name: /Person 1 entfernen/ }))

    const action = dispatched.find((a) => a.type === "REMOVE_PERSON")
    expect(action).toMatchObject({ type: "REMOVE_PERSON", id: "p-self" })

    // X button on the remaining (now sole) card is gone.
    expect(screen.queryByRole("button", { name: /Person 1 entfernen/ })).toBeNull()
  })
})
