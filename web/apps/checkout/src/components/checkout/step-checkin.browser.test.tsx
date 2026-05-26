// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { render, screen, cleanup } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, it, expect, afterEach, vi } from "vitest"
import { useReducer } from "react"
import { StepCheckin, type FamilyCandidate } from "./step-checkin"
import {
  personsReducer,
  initialPersons,
  type CheckoutPerson,
  type PersonsAction,
} from "./use-checkout-state"

afterEach(cleanup)

/**
 * Wrapper that provides a real persons reducer so dispatch actually
 * updates state. Captures dispatched actions for assertions.
 */
function renderCheckin({
  isAnonymous = true,
  kiosk = false,
  isAccountLoggedIn = false,
  personsOverride,
  onAdvance,
  familyCandidates,
}: {
  isAnonymous?: boolean
  kiosk?: boolean
  isAccountLoggedIn?: boolean
  personsOverride?: CheckoutPerson[]
  onAdvance?: () => Promise<void>
  familyCandidates?: FamilyCandidate[]
} = {}) {
  const dispatched: PersonsAction[] = []
  const onSignOut = vi.fn()

  function Wrapper() {
    const [persons, dispatch] = useReducer(
      personsReducer,
      personsOverride ?? initialPersons,
    )
    const wrappedDispatch = (action: PersonsAction) => {
      dispatched.push(action)
      dispatch(action)
    }
    return (
      <StepCheckin
        persons={persons}
        personsDispatch={wrappedDispatch}
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
    const onAdvance = vi.fn(async () => {})
    renderCheckin({ onAdvance })

    await user.click(screen.getByRole("button", { name: /Weiter/ }))

    expect(screen.getByText("Vorname ist erforderlich.")).toBeTruthy()
    expect(screen.getByText("Nachname ist erforderlich.")).toBeTruthy()
    expect(screen.getByText("E-Mail ist erforderlich.")).toBeTruthy()
    expect(screen.getByText("Nutzungsbestimmungen ist erforderlich.")).toBeTruthy()

    // onAdvance not called → step not advanced (URL nav lives there)
    expect(onAdvance).not.toHaveBeenCalled()
  })

  it("shows email format error for invalid email", async () => {
    const user = userEvent.setup()
    renderCheckin()

    const inputs = screen.getAllByRole("textbox")
    await user.type(inputs[0], "Max")
    await user.type(inputs[1], "Muster")
    await user.type(inputs[2], "not-valid")
    await user.tab()

    await user.click(screen.getByRole("button", { name: /Weiter/ }))

    expect(
      screen.getByText("E-Mail muss im Format name@address.xyz eingegeben werden."),
    ).toBeTruthy()
  })

  it("shows error on blur for touched fields", async () => {
    const user = userEvent.setup()
    renderCheckin()

    const inputs = screen.getAllByRole("textbox")
    await user.click(inputs[0])
    await user.tab()

    expect(screen.getByText("Vorname ist erforderlich.")).toBeTruthy()
  })

  it("clears error when field is corrected", async () => {
    const user = userEvent.setup()
    renderCheckin()

    await user.click(screen.getByRole("button", { name: /Weiter/ }))
    expect(screen.getByText("Vorname ist erforderlich.")).toBeTruthy()

    const inputs = screen.getAllByRole("textbox")
    await user.type(inputs[0], "Max")

    expect(screen.queryByText("Vorname ist erforderlich.")).toBeNull()
  })

  it("advances when all fields are valid", async () => {
    const user = userEvent.setup()
    const onAdvance = vi.fn(async () => {})
    renderCheckin({ onAdvance })

    const inputs = screen.getAllByRole("textbox")
    await user.type(inputs[0], "Max")
    await user.type(inputs[1], "Muster")
    await user.type(inputs[2], "max@test.com")

    await user.click(screen.getByRole("checkbox"))

    await user.click(screen.getByRole("button", { name: /Weiter/ }))

    expect(onAdvance).toHaveBeenCalledOnce()
  })

  it("Weiter button is always enabled (not disabled)", () => {
    renderCheckin()
    const btn = screen.getByRole("button", { name: /Weiter/ })
    expect(btn).not.toBeDisabled()
  })

  it("does not require terms for non-anonymous users", async () => {
    const user = userEvent.setup()
    const onAdvance = vi.fn(async () => {})
    renderCheckin({ isAnonymous: false, onAdvance })

    const inputs = screen.getAllByRole("textbox")
    await user.type(inputs[0], "Max")
    await user.type(inputs[1], "Muster")
    await user.type(inputs[2], "max@test.com")

    await user.click(screen.getByRole("button", { name: /Weiter/ }))

    expect(onAdvance).toHaveBeenCalledOnce()
  })

  it("newly added person does not show errors immediately after prior submit", async () => {
    const user = userEvent.setup()
    renderCheckin()

    await user.click(screen.getByRole("button", { name: /Weiter/ }))
    expect(screen.getByText("Vorname ist erforderlich.")).toBeTruthy()

    await user.click(screen.getByRole("button", { name: /Person hinzufügen/ }))

    expect(screen.queryByText("Vorname ist erforderlich.")).toBeNull()
  })

  // Issue #151 regression: onAdvance (anonymous sign-in + persist persons +
  // navigate to /visit) only runs once validation passes. Failed validation
  // must not call onAdvance.
  describe("eager anonymous sign-in (#151)", () => {
    it("does NOT call onAdvance when validation fails", async () => {
      const user = userEvent.setup()
      const onAdvance = vi.fn(async () => {})
      renderCheckin({ isAnonymous: true, onAdvance })

      await user.click(screen.getByRole("button", { name: /Weiter/ }))

      expect(onAdvance).not.toHaveBeenCalled()
    })

    it("calls onAdvance when validation passes", async () => {
      const user = userEvent.setup()
      const onAdvance = vi.fn(async () => {})
      renderCheckin({ isAnonymous: true, onAdvance })

      const inputs = screen.getAllByRole("textbox")
      await user.type(inputs[0], "Max")
      await user.type(inputs[1], "Muster")
      await user.type(inputs[2], "max@test.com")
      await user.click(screen.getByRole("checkbox"))

      await user.click(screen.getByRole("button", { name: /Weiter/ }))

      expect(onAdvance).toHaveBeenCalledOnce()
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
      personsOverride: [{
        id: "p1",
        firstName: "Max",
        lastName: "Muster",
        email: "max@test.com",
        userType: "erwachsen",
        termsAccepted: true,
        isPreFilled: true,
      }],
    })

    expect(screen.queryByText("Bereits registriert oder Konto erstellen?")).toBeNull()
    expect(screen.getByText(/Du bist nicht Max Muster\?/)).toBeTruthy()
    expect(screen.getByText(/Abmelden/)).toBeTruthy()
  })

  it("calls onSignOut when Abmelden is clicked", async () => {
    const user = userEvent.setup()
    const { onSignOut } = renderCheckin({
      isAnonymous: false,
      isAccountLoggedIn: true,
      personsOverride: [{
        id: "p1",
        firstName: "Max",
        lastName: "Muster",
        email: "max@test.com",
        userType: "erwachsen",
        termsAccepted: true,
        isPreFilled: true,
      }],
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
  const ownerPrimary: CheckoutPerson = {
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
      personsOverride: [ownerPrimary],
      familyCandidates: candidates,
    })

    expect(screen.getByRole("button", { name: /Lia Pfeffer/ })).toBeTruthy()
    expect(screen.getByRole("button", { name: /Yvonne Pfeiffer/ })).toBeTruthy()
  })

  it("renders no quick-add buttons when familyCandidates is empty / undefined", () => {
    renderCheckin({
      isAnonymous: false,
      isAccountLoggedIn: true,
      personsOverride: [ownerPrimary],
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
      personsOverride: [ownerPrimary],
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
    const remaining = candidates.filter((c) => c.userId !== "u-yvonne")
    renderCheckin({
      isAnonymous: false,
      isAccountLoggedIn: true,
      personsOverride: [
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
  const preFilled: CheckoutPerson = {
    id: "p-self",
    firstName: "Max",
    lastName: "Muster",
    email: "max@example.com",
    userType: "erwachsen",
    termsAccepted: true,
    isPreFilled: true,
    userId: "u-self",
  }
  const familyMember: CheckoutPerson = {
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
      personsOverride: [preFilled],
    })
    expect(screen.queryByRole("button", { name: /Person 1 entfernen/ })).toBeNull()
  })

  it("shows the X button on the pre-filled first card when ≥ 2 persons are on the visit", () => {
    renderCheckin({
      isAnonymous: false,
      isAccountLoggedIn: true,
      personsOverride: [preFilled, familyMember],
    })
    expect(screen.getByRole("button", { name: /Person 1 entfernen/ })).toBeTruthy()
  })

  it("removes the pre-filled first card when the X button is clicked", async () => {
    const user = userEvent.setup()
    const { dispatched } = renderCheckin({
      isAnonymous: false,
      isAccountLoggedIn: true,
      personsOverride: [preFilled, familyMember],
    })

    await user.click(screen.getByRole("button", { name: /Person 1 entfernen/ }))

    const action = dispatched.find((a) => a.type === "REMOVE_PERSON")
    expect(action).toMatchObject({ type: "REMOVE_PERSON", id: "p-self" })

    expect(screen.queryByRole("button", { name: /Person 1 entfernen/ })).toBeNull()
  })
})

// Issue #246: layout, animation, and re-add-self regressions.
describe("StepCheckin layout / animation (#246)", () => {
  const preFilled: CheckoutPerson = {
    id: "p-self",
    firstName: "Max",
    lastName: "Muster",
    email: "max@example.com",
    userType: "erwachsen",
    termsAccepted: true,
    isPreFilled: true,
    userId: "u-self",
  }
  const familyMember: CheckoutPerson = {
    id: "p-lia",
    firstName: "Lia",
    lastName: "Pfeffer",
    email: "lia@example.com",
    userType: "kind",
    termsAccepted: true,
    isPreFilled: true,
    userId: "u-lia",
  }

  it("reserves the heading row height on the first card when removable", () => {
    renderCheckin({
      isAnonymous: false,
      isAccountLoggedIn: true,
      personsOverride: [preFilled, familyMember],
    })
    const removeBtn = screen.getByRole("button", { name: /Person 1 entfernen/ })
    const headingRow = removeBtn.parentElement
    expect(headingRow).not.toBeNull()
    expect(headingRow!.querySelector("h3")).not.toBeNull()
  })

  it("applies an enter-animation class to each person card", () => {
    renderCheckin({
      isAnonymous: false,
      isAccountLoggedIn: true,
      personsOverride: [preFilled, familyMember],
    })
    const cards = screen.getAllByTestId("person-card")
    expect(cards.length).toBe(2)
    for (const card of cards) {
      expect(card.className).toContain("animate-in")
    }
  })

  it("re-adds self via a quick-add chip after self was removed", async () => {
    const user = userEvent.setup()
    const selfCandidate: FamilyCandidate = {
      userId: "u-self",
      firstName: "Max",
      lastName: "Muster",
      email: "max@example.com",
      userType: "erwachsen",
    }
    const { dispatched } = renderCheckin({
      isAnonymous: false,
      isAccountLoggedIn: true,
      personsOverride: [familyMember],
      familyCandidates: [selfCandidate],
    })

    const chip = screen.getByRole("button", { name: /Max Muster/ })
    expect(chip).toBeTruthy()
    await user.click(chip)

    const action = dispatched.find((a) => a.type === "ADD_FAMILY_PERSON")
    expect(action).toMatchObject({
      type: "ADD_FAMILY_PERSON",
      person: { userId: "u-self", firstName: "Max", lastName: "Muster" },
    })
  })
})
