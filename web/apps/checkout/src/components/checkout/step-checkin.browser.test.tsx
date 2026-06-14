// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { render, screen, cleanup, waitFor } from "@testing-library/react"
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
  signedInUserId,
  signedInEmail,
  isMember = false,
  personsOverride,
  onAdvance,
  familyCandidates,
  tagAuthLoading,
  tagAuthError,
  picc,
}: {
  isAnonymous?: boolean
  kiosk?: boolean
  isAccountLoggedIn?: boolean
  signedInUserId?: string | null
  signedInEmail?: string | null
  isMember?: boolean
  personsOverride?: CheckoutPerson[]
  onAdvance?: () => Promise<void>
  familyCandidates?: FamilyCandidate[]
  tagAuthLoading?: boolean
  tagAuthError?: string | null
  picc?: string
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
    // Default to "u-self" when the caller didn't pass an explicit id but
    // is exercising the logged-in branch — keeps existing tests terse
    // while still letting individual tests inject a different id.
    const effectiveSignedInUserId =
      signedInUserId === undefined && isAccountLoggedIn
        ? "u-self"
        : signedInUserId
    return (
      <StepCheckin
        persons={persons}
        personsDispatch={wrappedDispatch}
        isAnonymous={isAnonymous}
        kiosk={kiosk}
        isAccountLoggedIn={isAccountLoggedIn}
        signedInUserId={effectiveSignedInUserId}
        signedInEmail={signedInEmail}
        isMember={isMember}
        onSignOut={onSignOut}
        onAdvance={onAdvance}
        familyCandidates={familyCandidates}
        tagAuthLoading={tagAuthLoading}
        tagAuthError={tagAuthError}
        picc={picc}
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
    expect(screen.getByText("Anmelden oder registrieren")).toBeTruthy()
  })

  it("shows the NFC badge affordance hero for kiosk mode", () => {
    renderCheckin({ isAnonymous: true, kiosk: true })

    const affordance = screen.getByTestId("nfc-affordance")
    expect(affordance.getAttribute("data-mode")).toBe("hero")
    expect(affordance.textContent).toContain("Badge an den Leser halten")
    expect(screen.queryByText("Bereits registriert oder Konto erstellen?")).toBeNull()
  })

  it("collapses the kiosk NFC affordance to the compact bar while typing", async () => {
    const user = userEvent.setup()
    renderCheckin({ isAnonymous: true, kiosk: true })

    await user.type(screen.getAllByRole("textbox")[0], "Max")

    const affordance = screen.getByTestId("nfc-affordance")
    expect(affordance.getAttribute("data-mode")).toBe("compact")
    expect(
      screen.getByText("Badge an den Leser halten, um deine Daten zu laden"),
    ).toBeTruthy()
  })

  it("re-expands the kiosk NFC affordance when the form goes back to empty", async () => {
    const user = userEvent.setup()
    renderCheckin({ isAnonymous: true, kiosk: true })

    const input = screen.getAllByRole("textbox")[0]
    await user.type(input, "Max")
    expect(
      screen.getByTestId("nfc-affordance").getAttribute("data-mode"),
    ).toBe("compact")

    // Clear the typed content and move focus out of the form — after the
    // 120 ms blur bridge the hero returns.
    await user.clear(input)
    ;(document.activeElement as HTMLElement | null)?.blur()
    await waitFor(() =>
      expect(
        screen.getByTestId("nfc-affordance").getAttribute("data-mode"),
      ).toBe("hero"),
    )
  })

  it("folds badge verification progress into the kiosk affordance box", () => {
    renderCheckin({
      isAnonymous: true,
      kiosk: true,
      tagAuthLoading: true,
      picc: "PICC1",
    })

    const affordance = screen.getByTestId("nfc-affordance")
    expect(affordance.getAttribute("data-mode")).toBe("verifying")
    expect(screen.getByText("Badge erkannt")).toBeTruthy()
  })

  it("folds badge errors into the kiosk affordance box", () => {
    renderCheckin({
      isAnonymous: true,
      kiosk: true,
      tagAuthError: "replay detected",
      picc: "PICC1",
    })

    const affordance = screen.getByTestId("nfc-affordance")
    expect(affordance.getAttribute("data-mode")).toBe("error")
    expect(screen.getByText("Badge konnte nicht gelesen werden")).toBeTruthy()
  })

  it("renders no affordance once the tag identified the visitor", () => {
    // Tag-identified: isAnonymous=false, not account-logged-in. The box
    // disappears entirely — no fill/re-tap state.
    renderCheckin({
      isAnonymous: false,
      kiosk: true,
      personsOverride: [
        {
          id: "p1",
          firstName: "Anna",
          lastName: "Müller",
          email: "anna@example.com",
          userType: "erwachsen",
          termsAccepted: true,
          isPreFilled: true,
          userId: null,
        },
      ],
    })

    expect(screen.queryByTestId("nfc-affordance")).toBeNull()
  })

  it("renders the identity strip with name + Abmelden for logged-in users", () => {
    renderCheckin({
      isAnonymous: false,
      isAccountLoggedIn: true,
      signedInUserId: "u-self",
      signedInEmail: "max@test.com",
      personsOverride: [{
        id: "p1",
        firstName: "Max",
        lastName: "Muster",
        email: "max@test.com",
        userType: "erwachsen",
        termsAccepted: true,
        isPreFilled: true,
        userId: "u-self",
      }],
    })

    expect(screen.queryByText("Bereits registriert oder Konto erstellen?")).toBeNull()
    expect(screen.getByTestId("identity-strip")).toBeTruthy()
    expect(screen.getByText("Max Muster")).toBeTruthy()
    expect(screen.getByText(/max@test\.com/)).toBeTruthy()
    expect(screen.getByText("Abmelden")).toBeTruthy()
  })

  it("appends · Vereinsmitglied when the signed-in user has an active membership", () => {
    renderCheckin({
      isAnonymous: false,
      isAccountLoggedIn: true,
      signedInUserId: "u-self",
      signedInEmail: "max@test.com",
      isMember: true,
      personsOverride: [{
        id: "p1",
        firstName: "Max",
        lastName: "Muster",
        email: "max@test.com",
        userType: "erwachsen",
        termsAccepted: true,
        isPreFilled: true,
        userId: "u-self",
      }],
    })

    expect(screen.getByText(/max@test\.com · Vereinsmitglied/)).toBeTruthy()
  })

  it("calls onSignOut when Abmelden is clicked", async () => {
    const user = userEvent.setup()
    const { onSignOut } = renderCheckin({
      isAnonymous: false,
      isAccountLoggedIn: true,
      signedInUserId: "u-self",
      signedInEmail: "max@test.com",
      personsOverride: [{
        id: "p1",
        firstName: "Max",
        lastName: "Muster",
        email: "max@test.com",
        userType: "erwachsen",
        termsAccepted: true,
        isPreFilled: true,
        userId: "u-self",
      }],
    })

    await user.click(screen.getByText("Abmelden"))
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
    // Account-less child (ADR-0029): no email / login — rosterable.
    {
      userId: "u-lia",
      firstName: "Lia",
      lastName: "Pfeffer",
      email: "",
      userType: "kind",
      hasAccount: false,
    },
    // Adult co-member with their own account — chip renders disabled.
    {
      userId: "u-yvonne",
      firstName: "Yvonne",
      lastName: "Pfeiffer",
      email: "yvonne@example.com",
      userType: "erwachsen",
      hasAccount: true,
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
        email: "",
        userType: "kind",
      },
    })
  })

  it("renders an account-holding candidate disabled and never dispatches (ADR-0029)", async () => {
    const user = userEvent.setup()
    const { dispatched } = renderCheckin({
      isAnonymous: false,
      isAccountLoggedIn: true,
      personsOverride: [ownerPrimary],
      familyCandidates: candidates,
    })

    const yvonne = screen.getByRole("button", { name: /Yvonne Pfeiffer/ })
    expect((yvonne as HTMLButtonElement).disabled).toBe(true)
    // The hint explains why the chip can't be added.
    expect(
      screen.getByText("Familienmitglieder mit eigenem Konto checken separat ein."),
    ).toBeTruthy()

    await user.click(yvonne)
    expect(dispatched.find((a) => a.type === "ADD_FAMILY_PERSON")).toBeUndefined()
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

// Pre-filled persons render as IdentityStrips. The signed-in user's
// strip carries an Abmelden link AND — once a second person is on the
// visit — an X to remove themselves (Mike's "I added my kid, now I
// want to drop myself" flow). Family-added strips just get the X.
describe("Person removal", () => {
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

  it("hides the X when only one person is on the visit", () => {
    renderCheckin({
      isAnonymous: false,
      isAccountLoggedIn: true,
      personsOverride: [preFilled],
    })
    expect(screen.queryByRole("button", { name: /Person 1 entfernen/ })).toBeNull()
    // Abmelden is still reachable.
    expect(screen.getByText("Abmelden")).toBeTruthy()
  })

  it("shows X on both strips when two persons are on the visit", () => {
    renderCheckin({
      isAnonymous: false,
      isAccountLoggedIn: true,
      personsOverride: [preFilled, familyMember],
    })
    expect(screen.getByRole("button", { name: /Person 1 entfernen/ })).toBeTruthy()
    expect(screen.getByRole("button", { name: /Person 2 entfernen/ })).toBeTruthy()
  })

  it("removes the signed-in user when their strip's X is clicked", async () => {
    const user = userEvent.setup()
    const { dispatched } = renderCheckin({
      isAnonymous: false,
      isAccountLoggedIn: true,
      personsOverride: [preFilled, familyMember],
    })

    await user.click(screen.getByRole("button", { name: /Person 1 entfernen/ }))

    const action = dispatched.find((a) => a.type === "REMOVE_PERSON")
    expect(action).toMatchObject({ type: "REMOVE_PERSON", id: "p-self" })
  })

  it("removes a family-added strip when its X button is clicked", async () => {
    const user = userEvent.setup()
    const { dispatched } = renderCheckin({
      isAnonymous: false,
      isAccountLoggedIn: true,
      personsOverride: [preFilled, familyMember],
    })

    await user.click(screen.getByRole("button", { name: /Person 2 entfernen/ }))

    const action = dispatched.find((a) => a.type === "REMOVE_PERSON")
    expect(action).toMatchObject({ type: "REMOVE_PERSON", id: "p-lia" })
  })
})

// Regression: the "signed-in user" decision used to key off the array
// index (i === 0). Removing self and re-adding via a quick-add chip
// shifted self to index 1 — at that point the kid (now at index 0)
// inherited Abmelden + Vereinsmitglied + the parent's email, and self
// lost their identity affordances.
describe("Identity strip — keyed by userId, not index", () => {
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
  const selfPerson: CheckoutPerson = {
    id: "p-self",
    firstName: "Max",
    lastName: "Muster",
    email: "max@example.com",
    userType: "erwachsen",
    termsAccepted: true,
    isPreFilled: true,
    userId: "u-self",
  }

  it("does not show Abmelden / Vereinsmitglied on the kid's strip when self was removed", () => {
    renderCheckin({
      isAnonymous: false,
      isAccountLoggedIn: true,
      signedInUserId: "u-self",
      signedInEmail: "max@example.com",
      isMember: true,
      personsOverride: [familyMember],
    })

    const strip = screen.getByTestId("identity-strip")
    expect(strip.textContent).toContain("Lia Pfeffer")
    expect(strip.textContent).toContain("lia@example.com")
    // Crucially: the kid's strip must NOT inherit the parent's email,
    // membership tag, or sign-out affordance.
    expect(strip.textContent).not.toContain("max@example.com")
    expect(strip.textContent).not.toContain("Vereinsmitglied")
    expect(strip.textContent).not.toContain("Abmelden")
  })

  it("keeps Abmelden + Vereinsmitglied on self even when re-added at a higher index", () => {
    // Persons array has self at index 1 (kid at 0) — the order the
    // user lands on after remove-then-quick-add-back.
    renderCheckin({
      isAnonymous: false,
      isAccountLoggedIn: true,
      signedInUserId: "u-self",
      signedInEmail: "max@example.com",
      isMember: true,
      personsOverride: [familyMember, selfPerson],
    })

    const strips = screen.getAllByTestId("identity-strip")
    expect(strips).toHaveLength(2)

    const kidStrip = strips[0]
    const selfStrip = strips[1]

    expect(kidStrip.textContent).toContain("Lia Pfeffer")
    expect(kidStrip.textContent).not.toContain("Vereinsmitglied")
    expect(kidStrip.textContent).not.toContain("Abmelden")

    expect(selfStrip.textContent).toContain("Max Muster")
    expect(selfStrip.textContent).toContain("max@example.com")
    expect(selfStrip.textContent).toContain("Vereinsmitglied")
    expect(selfStrip.textContent).toContain("Abmelden")
  })
})
