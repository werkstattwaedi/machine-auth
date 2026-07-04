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
import { render, screen, cleanup } from "@testing-library/react"
import type { CheckoutPerson } from "@/components/checkout/use-checkout-state"

// ── Capture the route component (mirrors visit.test.tsx) ─────────────────
let CapturedComponent: (() => React.JSX.Element) | null = null
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: { component: () => React.JSX.Element }) => {
    CapturedComponent = opts.component
    return opts
  },
  useNavigate: () => vi.fn(),
  // No rescan hint in these scenarios.
  useSearch: () => ({}),
}))

// The confirmation dialog pulls in nothing we exercise here; stub it out so
// the test stays a pure footer-gating render check.
vi.mock("@/components/checkout/visit-started-dialog", () => ({
  VisitStartedDialog: () => null,
}))

// The embedded account sign-in needs the full Auth/Firebase provider stack
// (covered by its own checkin-signin tests); stub it here.
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
}

function buildCtx({ isAnonymous, kiosk }: CtxOverrides) {
  return {
    persons: [anonPerson],
    personsDispatch: vi.fn(),
    isAnonymous,
    kiosk,
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
  mockUseWizardContext.mockReturnValue(buildCtx(overrides))
  const Comp = CapturedComponent!
  return render(<Comp />)
}

// createFileRoute runs at module-eval time and captures CheckinRoute.
beforeAll(async () => {
  await import("./checkin")
})

afterEach(() => {
  cleanup()
  mockUseWizardContext.mockReset()
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
