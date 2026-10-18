// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { render, screen, cleanup } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, it, expect, afterEach, vi } from "vitest"
import { useReducer } from "react"

// The embedded account sign-in needs the full Auth/Firebase provider stack
// (covered by checkin-signin.test.tsx). Stub it to a pass-through so the
// kiosk NFC affordance — passed as children — still renders.
vi.mock("./checkin-signin", () => ({
  CheckinSignin: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="checkin-signin-stub">{children}</div>
  ),
}))

import { StepCheckin } from "./step-checkin"
import {
  personsReducer,
  initialPersons,
  type CheckoutPerson,
  type PersonsAction,
} from "./use-checkout-state"

afterEach(cleanup)

/** The guest form hides behind the "Als Gast" segment while anonymous —
 *  flip to it first (account is the default on an empty roster). */
async function openGuestTab(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId("checkin-seg-guest"))
}

/**
 * Wrapper that provides a real persons reducer so dispatch actually
 * updates state. Captures dispatched actions for assertions.
 */
interface CheckinOpts {
  isAnonymous?: boolean
  kiosk?: boolean
  isAccountLoggedIn?: boolean
  signedInUserId?: string | null
  signedInEmail?: string | null
  maskEmails?: boolean
  isMember?: boolean
  personsOverride?: CheckoutPerson[]
  onAdvance?: () => Promise<void>
  tagAuthLoading?: boolean
  tagAuthError?: string | null
  picc?: string
}

function renderCheckin(opts: CheckinOpts = {}) {
  const dispatched: PersonsAction[] = []

  function Wrapper({
    isAnonymous = true,
    kiosk = false,
    isAccountLoggedIn = false,
    signedInUserId,
    signedInEmail,
    maskEmails,
    isMember = false,
    personsOverride,
    onAdvance,
    tagAuthLoading,
    tagAuthError,
    picc,
  }: CheckinOpts) {
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
        maskEmails={maskEmails}
        isMember={isMember}
        onAdvance={onAdvance}
        tagAuthLoading={tagAuthLoading}
        tagAuthError={tagAuthError}
        picc={picc}
      />
    )
  }

  const { rerender } = render(<Wrapper {...opts} />)
  // Re-render with patched props while keeping the reducer state (same
  // component instance) — used to simulate e.g. a badge tap mid-flow.
  const rerenderWith = (patch: Partial<CheckinOpts>) =>
    rerender(<Wrapper {...opts} {...patch} />)
  return { dispatched, rerenderWith }
}

describe("StepCheckin validation", () => {
  it("shows errors when Weiter is clicked with empty fields", async () => {
    const user = userEvent.setup()
    const onAdvance = vi.fn(async () => {})
    renderCheckin({ onAdvance })
    await openGuestTab(user)

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
    await openGuestTab(user)

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
    await openGuestTab(user)

    const inputs = screen.getAllByRole("textbox")
    await user.click(inputs[0])
    await user.tab()

    expect(screen.getByText("Vorname ist erforderlich.")).toBeTruthy()
  })

  it("clears error when field is corrected", async () => {
    const user = userEvent.setup()
    renderCheckin()
    await openGuestTab(user)

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
    await openGuestTab(user)

    const inputs = screen.getAllByRole("textbox")
    await user.type(inputs[0], "Max")
    await user.type(inputs[1], "Muster")
    await user.type(inputs[2], "max@test.com")

    await user.click(screen.getByRole("checkbox"))

    await user.click(screen.getByRole("button", { name: /Weiter/ }))

    expect(onAdvance).toHaveBeenCalledOnce()
  })

  it("Weiter is disabled on the account tab, enabled on the guest tab", async () => {
    const user = userEvent.setup()
    renderCheckin()
    // Account tab (default on an empty roster): there's nothing to advance
    // with — the visitor signs in or switches to the guest form first.
    const btn = screen.getByRole("button", { name: /Weiter/ })
    expect(btn).toBeDisabled()
    await openGuestTab(user)
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
    await openGuestTab(user)

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
      await openGuestTab(user)

      await user.click(screen.getByRole("button", { name: /Weiter/ }))

      expect(onAdvance).not.toHaveBeenCalled()
    })

    it("calls onAdvance when validation passes", async () => {
      const user = userEvent.setup()
      const onAdvance = vi.fn(async () => {})
      renderCheckin({ isAnonymous: true, onAdvance })
      await openGuestTab(user)

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

describe("Account/guest switcher", () => {
  it("shows the switcher with the account section as the default", () => {
    renderCheckin({ isAnonymous: true, kiosk: false })

    expect(screen.getByTestId("checkin-seg-account")).toBeTruthy()
    expect(screen.getByTestId("checkin-seg-guest")).toBeTruthy()
    expect(
      screen.getByTestId("checkin-seg-account").getAttribute("aria-selected"),
    ).toBe("true")
    // Account section renders instead of the guest form; the old /login
    // hint link is gone.
    expect(screen.getByTestId("checkin-signin-stub")).toBeTruthy()
    expect(screen.queryByTestId("person-card")).toBeNull()
    expect(screen.queryByText("Bereits registriert oder Konto erstellen?")).toBeNull()
  })

  it("defaults to the guest section when the roster already carries data", () => {
    renderCheckin({
      isAnonymous: true,
      personsOverride: [
        {
          id: "p1",
          firstName: "Max",
          lastName: "",
          email: "",
          userType: "erwachsen",
          termsAccepted: false,
          isPreFilled: false,
          usageType: "regular",
          userId: null,
        },
      ],
    })

    expect(
      screen.getByTestId("checkin-seg-guest").getAttribute("aria-selected"),
    ).toBe("true")
    expect(screen.getByTestId("person-card")).toBeTruthy()
  })

  it("keeps typed guest data when switching to account and back", async () => {
    const user = userEvent.setup()
    renderCheckin({ isAnonymous: true })
    await openGuestTab(user)

    await user.type(screen.getAllByRole("textbox")[0], "Max")
    await user.click(screen.getByTestId("checkin-seg-account"))
    expect(screen.queryByTestId("person-card")).toBeNull()

    await openGuestTab(user)
    expect(
      (screen.getAllByRole("textbox")[0] as HTMLInputElement).value,
    ).toBe("Max")
  })

  it("hides the switcher entirely once identified", () => {
    renderCheckin({ isAnonymous: false, isAccountLoggedIn: true })
    expect(screen.queryByTestId("checkin-seg-account")).toBeNull()
    expect(screen.queryByTestId("checkin-seg-guest")).toBeNull()
  })

  it("shows the NFC badge affordance hero in the kiosk account section", () => {
    renderCheckin({ isAnonymous: true, kiosk: true })

    const affordance = screen.getByTestId("nfc-affordance")
    expect(affordance.getAttribute("data-mode")).toBe("hero")
    expect(affordance.textContent).toContain("Badge an den Leser halten")
  })

  it("hides the affordance on the guest tab, returns to it on a badge tap", async () => {
    const user = userEvent.setup()
    const { rerenderWith } = renderCheckin({ isAnonymous: true, kiosk: true })
    await openGuestTab(user)
    expect(screen.queryByTestId("nfc-affordance")).toBeNull()

    // A badge tap while the guest form is open must surface its verify
    // feedback — the step flips back to the account section.
    rerenderWith({ tagAuthLoading: true, picc: "PICC1" })
    expect(
      screen.getByTestId("nfc-affordance").getAttribute("data-mode"),
    ).toBe("verifying")
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
          usageType: "regular",
          userId: null,
        },
      ],
    })

    expect(screen.queryByTestId("nfc-affordance")).toBeNull()
  })

  it("renders the identity strip with name + email for logged-in users", () => {
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
        usageType: "regular",
        userId: "u-self",
      }],
    })

    expect(screen.queryByText("Bereits registriert oder Konto erstellen?")).toBeNull()
    expect(screen.getByTestId("identity-strip")).toBeTruthy()
    expect(screen.getByText("Max Muster")).toBeTruthy()
    expect(screen.getByText(/max@test\.com/)).toBeTruthy()
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
        usageType: "regular",
        userId: "u-self",
      }],
    })

    expect(screen.getByText(/max@test\.com · Vereinsmitglied/)).toBeTruthy()
  })

  // Issue #710: signing out lives in the header account menu — the strip
  // carries no "Abmelden" of its own any more.
  it("does not render Abmelden on the signed-in user's identity strip", () => {
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
        usageType: "regular",
        userId: "u-self",
      }],
    })

    expect(screen.getByTestId("identity-strip").textContent).not.toContain("Abmelden")
    expect(screen.queryByRole("button", { name: "Abmelden" })).toBeNull()
  })

  it("hides identity hint when tag-identified (not anonymous, not account)", () => {
    renderCheckin({ isAnonymous: false, isAccountLoggedIn: false })

    expect(screen.queryByText("Bereits registriert oder Konto erstellen?")).toBeNull()
    expect(screen.queryByText("Badge an den Leser halten")).toBeNull()
  })
})

// Pre-filled persons render as IdentityStrips. The owner (signed-in user)
// always stays on their own visit (ADR-0048); every other line — a guest,
// or a family member rehydrated from an open checkout that predates the
// ADR — carries an X once a second person is on the visit.
describe("Person removal", () => {
  const preFilled: CheckoutPerson = {
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
  const legacyMember: CheckoutPerson = {
    id: "p-lia",
    firstName: "Lia",
    lastName: "Pfeffer",
    email: "",
    userType: "kind",
    termsAccepted: true,
    isPreFilled: true,
    usageType: "regular",
    userId: "u-lia",
  }

  it("hides the X when only one person is on the visit", () => {
    renderCheckin({
      isAnonymous: false,
      isAccountLoggedIn: true,
      personsOverride: [preFilled],
    })
    expect(screen.queryByRole("button", { name: /Person 1 entfernen/ })).toBeNull()
  })

  it("never offers to remove the owner, even with a second person on the visit", () => {
    renderCheckin({
      isAnonymous: false,
      isAccountLoggedIn: true,
      personsOverride: [preFilled, legacyMember],
    })
    expect(screen.queryByRole("button", { name: /Person 1 entfernen/ })).toBeNull()
    expect(screen.getByRole("button", { name: /Person 2 entfernen/ })).toBeTruthy()
  })

  it("removes a non-owner strip when its X button is clicked", async () => {
    const user = userEvent.setup()
    const { dispatched } = renderCheckin({
      isAnonymous: false,
      isAccountLoggedIn: true,
      personsOverride: [preFilled, legacyMember],
    })

    await user.click(screen.getByRole("button", { name: /Person 2 entfernen/ }))

    const action = dispatched.find((a) => a.type === "REMOVE_PERSON")
    expect(action).toMatchObject({ type: "REMOVE_PERSON", id: "p-lia" })
  })
})

// Regression: the "signed-in user" decision used to key off the array
// index (i === 0). A roster with self at index 1 (rehydrated from an open
// checkout) made the kid at index 0 inherit Vereinsmitglied + the parent's
// email, and self lost their identity affordances.
describe("Identity strip — keyed by userId, not index", () => {
  const familyMember: CheckoutPerson = {
    id: "p-lia",
    firstName: "Lia",
    lastName: "Pfeffer",
    email: "lia@example.com",
    userType: "kind",
    termsAccepted: true,
    isPreFilled: true,
    usageType: "regular",
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
    usageType: "regular",
    userId: "u-self",
  }

  it("does not show Vereinsmitglied on the kid's strip when self was removed", () => {
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
    // or membership tag.
    expect(strip.textContent).not.toContain("max@example.com")
    expect(strip.textContent).not.toContain("Vereinsmitglied")
  })

  it("keeps Vereinsmitglied on self even when re-added at a higher index", () => {
    // Persons array has self at index 1 (kid at 0), as a rehydrated
    // open checkout can carry it.
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

    expect(selfStrip.textContent).toContain("Max Muster")
    expect(selfStrip.textContent).toContain("max@example.com")
    expect(selfStrip.textContent).toContain("Vereinsmitglied")
  })
})

// Issue #668: an un-elevated kiosk badge session must not reveal the
// addresses on the card; the step-up (ADR-0041) unmasks them.
describe("StepCheckin e-mail masking", () => {
  const badgeOwner: CheckoutPerson = {
    id: "p1",
    firstName: "Max",
    lastName: "Muster",
    email: "max@example.com",
    userType: "erwachsen",
    termsAccepted: true,
    isPreFilled: true,
    usageType: "regular",
    userId: "u-badge",
  }
  const familyMember: CheckoutPerson = {
    ...badgeOwner,
    id: "p2",
    firstName: "Mia",
    email: "mia@family.ch",
    userId: "u-family",
  }
  const badgeSession = {
    isAnonymous: false,
    kiosk: true,
    isAccountLoggedIn: false,
    personsOverride: [badgeOwner, familyMember],
  }
  const stripTexts = () =>
    screen.getAllByTestId("identity-strip").map((el) => el.textContent ?? "")

  it("masks every strip's e-mail while the badge session is un-elevated", () => {
    renderCheckin({ ...badgeSession, maskEmails: true })

    const [owner, family] = stripTexts()
    expect(owner).toContain("ma•••@ex•••.com")
    expect(owner).not.toContain("max@example.com")
    expect(family).toContain("mi•••@fa•••.ch")
    expect(family).not.toContain("mia@family.ch")
  })

  it("shows the full addresses when not masking", () => {
    renderCheckin(badgeSession)

    const [owner, family] = stripTexts()
    expect(owner).toContain("max@example.com")
    expect(family).toContain("mia@family.ch")
  })

  it("unmasks in place once the session is elevated", () => {
    const { rerenderWith } = renderCheckin({ ...badgeSession, maskEmails: true })
    expect(stripTexts()[0]).not.toContain("max@example.com")

    rerenderWith({ maskEmails: false })

    expect(stripTexts()[0]).toContain("max@example.com")
  })
})
