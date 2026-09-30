// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * CheckinRoute — kiosk "Besuch starten" gating (issue #467).
 *
 * The kiosk footer's primary "Besuch starten" action wires an
 * `onStartVisit` handler onto StepCheckin. It must ONLY be offered when
 * the kiosk visitor is already identified (tag-tap or signed in). A truly
 * anonymous kiosk guest is bound to a throwaway anon session they can't
 * return to, so "starting a visit" they'd immediately lose is pointless —
 * they must keep the plain "Weiter" flow.
 *
 * Regression net: render the real StepCheckin via the route and assert the
 * footer button by identity, mirroring routes/_wizard/visit.test.tsx.
 */

import { describe, it, expect, vi, beforeAll, afterEach } from "vitest"
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react"
import type { CheckoutPerson } from "@/components/checkout/use-checkout-state"

const mockNavigate = vi.fn()
// The wizard layout's search params; `next` is the cold-scan target (#664).
let mockSearch: { next?: string } = {}

// ── Capture the route component (mirrors visit.test.tsx) ─────────────────
let CapturedComponent: (() => React.JSX.Element) | null = null
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: { component: () => React.JSX.Element }) => {
    CapturedComponent = opts.component
    return opts
  },
  useNavigate: () => mockNavigate,
  useSearch: () => mockSearch,
}))

// The confirmation dialog pulls in nothing we exercise here; stub it out so
// the test stays a pure footer-gating render check.
vi.mock("@/components/checkout/visit-started-dialog", () => ({
  VisitStartedDialog: () => null,
}))

// The embedded account sign-in needs the full Auth/Firebase provider stack
// (covered by its own checkin-signin tests); stub it here.
// The kiosk member-area entry points need the auth + elevation providers;
// they are out of scope for the footer gating under test.
vi.mock("@/components/checkout/kiosk-account-actions", () => ({
  KioskAccountActions: () => null,
}))

vi.mock("@/components/checkout/checkin-signin", () => ({
  CheckinSignin: () => null,
}))

// ── Wizard context harness ───────────────────────────────────────────────
const mockUseWizardContext = vi.fn()
vi.mock("@/components/checkout/wizard-context", () => ({
  useWizardContext: () => mockUseWizardContext(),
}))

const anonPerson: CheckoutPerson = {
  id: "p1",
  firstName: "Max",
  lastName: "Muster",
  email: "max@example.com",
  userType: "erwachsen",
  termsAccepted: true,
  isPreFilled: false,
  userId: null,
}

interface CtxOverrides {
  isAnonymous: boolean
  kiosk: boolean
  openCheckout?: { id: string } | null
}

function buildCtx({ isAnonymous, kiosk, openCheckout = null }: CtxOverrides) {
  return {
    persons: [anonPerson],
    personsDispatch: vi.fn(),
    isAnonymous,
    kiosk,
    openCheckout,
    isAccountLoggedIn: false,
    identifiedUserDoc: null,
    isMember: false,
    familyCandidates: [],
    startOver: vi.fn(),
    persistPersons: vi.fn().mockResolvedValue(undefined),
    signInAnonymouslyIfNeeded: vi.fn().mockResolvedValue(undefined),
  }
}

function renderCheckin(overrides: CtxOverrides) {
  const ctx = buildCtx(overrides)
  mockUseWizardContext.mockReturnValue(ctx)
  const Comp = CapturedComponent!
  render(<Comp />)
  return ctx
}

// createFileRoute runs at module-eval time and captures CheckinRoute.
beforeAll(async () => {
  await import("./checkin")
})

afterEach(() => {
  cleanup()
  mockUseWizardContext.mockReset()
  mockNavigate.mockReset()
  mockSearch = {}
})

describe("CheckinRoute — kiosk 'Besuch starten' gating (issue #467)", () => {
  it("hides 'Besuch starten' for an anonymous kiosk guest (only 'Weiter')", () => {
    renderCheckin({ isAnonymous: true, kiosk: true })
    expect(screen.queryByRole("button", { name: /Besuch starten/ })).toBeNull()
    expect(screen.getByRole("button", { name: /^Weiter$/ })).toBeTruthy()
  })

  it("shows 'Besuch starten' for an identified kiosk visitor (tag-tap / signed in)", () => {
    renderCheckin({ isAnonymous: false, kiosk: true })
    expect(
      screen.getByRole("button", { name: /Besuch starten/ }),
    ).toBeTruthy()
    expect(
      screen.getByRole("button", { name: /Material erfassen/ }),
    ).toBeTruthy()
    expect(screen.queryByRole("button", { name: /^Weiter$/ })).toBeNull()
  })

  it("keeps the plain 'Weiter' for an anonymous browser guest (non-kiosk)", () => {
    renderCheckin({ isAnonymous: true, kiosk: false })
    expect(screen.queryByRole("button", { name: /Besuch starten/ })).toBeNull()
    expect(screen.getByRole("button", { name: /^Weiter$/ })).toBeTruthy()
  })
})

const TARGET_LABEL = "Besuch starten und Material hinzufügen"
const BANNER = /danach geht es direkt weiter zum gescannten Material/

describe("CheckinRoute — cold QR scan target in `next` (issue #664)", () => {
  it("names the target on the primary button and resumes it after check-in", async () => {
    mockSearch = { next: "/visit/add/list/abc" }
    const ctx = renderCheckin({ isAnonymous: true, kiosk: false })

    expect(screen.getByText(BANNER)).toBeTruthy()
    // One primary action — the generic "Weiter" is replaced, not joined.
    expect(screen.queryByRole("button", { name: /^Weiter$/ })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: TARGET_LABEL }))

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledOnce())
    // The checkout exists before the picker opens.
    expect(ctx.persistPersons).toHaveBeenCalledOnce()
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/visit/add/list/$listId",
      params: { listId: "abc" },
      search: {},
      replace: false,
    })
  })

  it.each([
    [
      "/visit/add/item/3210",
      { to: "/visit/add/item/$code", params: { code: "3210" } },
    ],
    [
      "/visit/add/item/3210/a3",
      {
        to: "/visit/add/item/$code/$variantId",
        params: { code: "3210", variantId: "a3" },
      },
    ],
    [
      "/visit/add/workshop/holz",
      {
        to: "/visit/add/workshop/$workshopId",
        params: { workshopId: "holz" },
      },
    ],
  ])("resumes %s", async (next, target) => {
    mockSearch = { next }
    renderCheckin({ isAnonymous: true, kiosk: false })
    fireEvent.click(screen.getByRole("button", { name: TARGET_LABEL }))
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledOnce())
    expect(mockNavigate).toHaveBeenCalledWith({
      ...target,
      search: {},
      replace: false,
    })
  })

  it.each([
    ["a path outside the add routes", "/account/profile"],
    ["a protocol-relative URL", "//evil.example/visit/add/list/x"],
    ["the target-less add index", "/visit/add"],
  ])("ignores %s: no banner, plain 'Weiter' to /visit", async (_label, next) => {
    mockSearch = { next }
    renderCheckin({ isAnonymous: true, kiosk: false })

    expect(screen.queryByText(BANNER)).toBeNull()
    expect(screen.queryByRole("button", { name: TARGET_LABEL })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: /^Weiter$/ }))

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledOnce())
    expect(mockNavigate).toHaveBeenCalledWith({ to: "/visit", search: {} })
  })

  it("stays on /checkin when creating the checkout fails", async () => {
    mockSearch = { next: "/visit/add/list/abc" }
    const ctx = buildCtx({ isAnonymous: true, kiosk: false })
    ctx.persistPersons = vi.fn().mockRejectedValue(new Error("offline"))
    mockUseWizardContext.mockReturnValue(ctx)
    const Comp = CapturedComponent!
    render(<Comp />)

    const button = screen.getByRole("button", { name: TARGET_LABEL })
    fireEvent.click(button)
    await waitFor(() => expect(ctx.persistPersons).toHaveBeenCalledOnce())
    await waitFor(() =>
      expect((button as HTMLButtonElement).disabled).toBe(false),
    )
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it("kiosk: the target action is the primary, keeps the kiosk flag; 'Besuch starten' stays available", async () => {
    mockSearch = { next: "/visit/add/list/abc" }
    renderCheckin({ isAnonymous: false, kiosk: true })

    // The plain check-in is still offered, but the scanned target replaces
    // the generic "Material erfassen".
    expect(screen.getByRole("button", { name: /^Besuch starten$/ })).toBeTruthy()
    expect(screen.queryByRole("button", { name: /Material erfassen/ })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: TARGET_LABEL }))

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledOnce())
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/visit/add/list/$listId",
      params: { listId: "abc" },
      search: { kiosk: "" },
      replace: false,
    })
  })

  it("with a visit already running the label drops 'Besuch starten'", () => {
    mockSearch = { next: "/visit/add/list/abc" }
    renderCheckin({
      isAnonymous: true,
      kiosk: false,
      openCheckout: { id: "co1" },
    })
    expect(
      screen.getByRole("button", { name: /^Material hinzufügen$/ }),
    ).toBeTruthy()
    expect(screen.queryByRole("button", { name: TARGET_LABEL })).toBeNull()
  })
})
