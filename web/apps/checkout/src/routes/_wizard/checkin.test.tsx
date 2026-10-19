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
 *
 * Issue #732: the kiosk badge-tap countdown gating, the start → reset with
 * the start-screen toast param, the toast itself, and the screen state the
 * route publishes for BridgeNfcRouter.
 */

import { describe, it, expect, vi, beforeAll, afterEach } from "vitest"
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react"
import {
  getKioskSessionState,
  startPendingVisit,
} from "@/components/checkout/kiosk-session-guard"
import type { CheckoutPerson } from "@/components/checkout/use-checkout-state"

// ── Capture the route component (mirrors visit.test.tsx) ─────────────────
let CapturedComponent: (() => React.JSX.Element) | null = null
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: { component: () => React.JSX.Element }) => {
    CapturedComponent = opts.component
    return opts
  },
  useNavigate: () => mockNavigate,
  useSearch: () => mockSearch.current,
}))
const mockNavigate = vi.fn()
const mockSearch: { current: Record<string, string> } = { current: {} }

const mockToastSuccess = vi.fn()
const mockToastError = vi.fn()
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}))

const mockBridge = { available: false }
vi.mock("@modules/lib/use-bridge", () => ({
  useBridge: () => mockBridge,
}))

vi.mock("@modules/lib/firebase-context", () => ({ useDb: () => ({}) }))
// Only the masking flag (#668) reads the auth context; StepCheckin's own
// tests cover it.
vi.mock("@modules/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@modules/lib/auth")>()),
  useAuth: () => ({ sessionKind: null, isKioskElevated: false }),
}))
vi.mock("@modules/lib/firestore-helpers", () => ({
  userRef: (_db: unknown, id: string) => ({ id, path: `users/${id}` }),
}))
// The badge user's profile, read to keep the countdown away from the
// welcome onboarding.
const COMPLETE_PROFILE = {
  id: "u1",
  firstName: "Andrea",
  lastName: "Muster",
  termsAcceptedAt: new Date(),
}
const mockProfile: { current: unknown } = { current: COMPLETE_PROFILE }
vi.mock("@modules/lib/firestore", () => ({
  useDocument: (ref: unknown) => ({
    data: ref ? mockProfile.current : null,
    loading: false,
  }),
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
  usageType: "regular",
  userId: null,
}

// What saveCompanions hands on: the roster with a saved-person link.
const linkedPersons: CheckoutPerson[] = [{ ...anonPerson, savedPersonId: "s-1" }]

interface CtxOverrides {
  isAnonymous: boolean
  kiosk: boolean
  identifiedByBadge?: boolean
  openCheckout?: { id: string; usageType: string } | null
  persistPersons?: ReturnType<typeof vi.fn>
  saveCompanions?: ReturnType<typeof vi.fn>
}

function buildCtx({
  isAnonymous,
  kiosk,
  identifiedByBadge = false,
  openCheckout = null,
  persistPersons = vi.fn().mockResolvedValue(undefined),
  saveCompanions = vi.fn().mockResolvedValue(linkedPersons),
}: CtxOverrides) {
  return {
    persons: [anonPerson],
    personsDispatch: vi.fn(),
    isAnonymous,
    kiosk,
    isAccountLoggedIn: false,
    isTagIdentified: !isAnonymous,
    identifiedByBadge,
    identifiedFirstName: isAnonymous ? null : "Andrea",
    identifiedUserDoc: null,
    identifiedUserRef: isAnonymous ? null : { id: "u1" },
    isMember: false,
    openCheckout,
    openCheckoutLoading: false,
    tagAuthLoading: false,
    tagAuthError: null,
    startOver: vi.fn().mockResolvedValue(undefined),
    persistPersons,
    saveCompanions,
    savedPersons: [],
    deleteSavedPerson: vi.fn().mockResolvedValue(undefined),
    pricingConfig: null,
    signInAnonymouslyIfNeeded: vi.fn().mockResolvedValue(undefined),
  }
}

function renderCheckin(overrides: CtxOverrides) {
  const ctx = buildCtx(overrides)
  mockUseWizardContext.mockReturnValue(ctx)
  const Comp = CapturedComponent!
  return { ...render(<Comp />), ctx }
}

function startButton() {
  return screen.getByRole("button", { name: /Besuch starten/ })
}

// createFileRoute runs at module-eval time and captures CheckinRoute.
beforeAll(async () => {
  await import("./checkin")
})

afterEach(() => {
  vi.useRealTimers()
  cleanup()
  mockUseWizardContext.mockReset()
  mockNavigate.mockReset()
  mockToastSuccess.mockReset()
  mockToastError.mockReset()
  mockSearch.current = {}
  mockBridge.available = false
  mockProfile.current = COMPLETE_PROFILE
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

// Issue #719: the inline "Konto verwalten" / "Mitglied werden" buttons
// duplicated the header account menu, which is the single kiosk entry point
// into the member area (ADR-0041 §4).
describe("CheckinRoute — no inline kiosk account actions (issue #719)", () => {
  it("renders no 'Konto verwalten' / 'Mitglied werden' for an identified non-member kiosk visitor", () => {
    renderCheckin({ isAnonymous: false, kiosk: true })
    expect(screen.queryByRole("button", { name: /Konto verwalten/ })).toBeNull()
    expect(screen.queryByRole("button", { name: /Mitglied werden/ })).toBeNull()
    expect(screen.queryByTestId("kiosk-account-actions")).toBeNull()
  })
})

describe("CheckinRoute — kiosk auto-start gating (issue #732)", () => {
  const badgeKiosk = { isAnonymous: false, kiosk: true, identifiedByBadge: true }

  it("runs the countdown after a badge tap on the kiosk with no open checkout", () => {
    mockBridge.available = true
    renderCheckin(badgeKiosk)
    expect(startButton().dataset.countdown).toBe("running")
  })

  it("no countdown for an e-mail/SMS code sign-in", () => {
    mockBridge.available = true
    renderCheckin({ ...badgeKiosk, identifiedByBadge: false })
    expect(startButton().dataset.countdown).toBeUndefined()
  })

  it("no countdown without the kiosk bridge (?kiosk alone is not enough)", () => {
    renderCheckin(badgeKiosk)
    expect(startButton().dataset.countdown).toBeUndefined()
  })

  it("no countdown with an open checkout", () => {
    mockBridge.available = true
    renderCheckin({
      ...badgeKiosk,
      openCheckout: { id: "c1", usageType: "materialbezug" },
    })
    expect(startButton().dataset.countdown).toBeUndefined()
  })

  it("no countdown while the welcome onboarding has to run", () => {
    mockBridge.available = true
    mockProfile.current = { id: "u1", firstName: "Andrea", lastName: "Muster" }
    renderCheckin(badgeKiosk)
    expect(startButton().dataset.countdown).toBeUndefined()
  })

  it("a touch while the decision is still loading keeps the countdown off", () => {
    mockBridge.available = true
    mockProfile.current = null
    const { rerender } = renderCheckin(badgeKiosk)
    fireEvent.pointerDown(document.body)
    mockProfile.current = COMPLETE_PROFILE
    const Comp = CapturedComponent!
    rerender(<Comp />)
    expect(startButton().dataset.countdown).toBeUndefined()
  })

  it("publishes a running countdown as autoStartPending", () => {
    mockBridge.available = true
    renderCheckin(badgeKiosk)
    expect(getKioskSessionState()).toMatchObject({
      autoStartPending: true,
      onCheckinScreen: false,
      holderFirstName: "Andrea",
    })
  })

  it("after a touch the screen counts as an unstarted check-in", () => {
    mockBridge.available = true
    renderCheckin(badgeKiosk)
    fireEvent.pointerDown(document.body)
    expect(startButton().dataset.countdown).toBeUndefined()
    expect(getKioskSessionState()).toMatchObject({
      autoStartPending: false,
      onCheckinScreen: true,
    })
  })

  it("a code sign-in on the kiosk counts as an unstarted check-in", () => {
    renderCheckin({ ...badgeKiosk, identifiedByBadge: false })
    expect(getKioskSessionState()).toMatchObject({
      autoStartPending: false,
      onCheckinScreen: true,
    })
  })

  it("startPendingVisit starts the visit without resetting the terminal", async () => {
    mockBridge.available = true
    const { ctx } = renderCheckin(badgeKiosk)
    await expect(startPendingVisit()).resolves.toBe("Andrea")
    expect(ctx.persistPersons).toHaveBeenCalledWith({ persons: linkedPersons })
    // Issue #605: ticked companions are saved on the hand-off path too.
    expect(ctx.saveCompanions).toHaveBeenCalledTimes(1)
    expect(ctx.startOver).not.toHaveBeenCalled()
  })

  it("a start that never settles releases the tap after the timeout", async () => {
    const { START_HANDOFF_TIMEOUT_MS } = await import("./checkin")
    vi.useFakeTimers()
    mockBridge.available = true
    // Firestore unreachable: the write neither resolves nor rejects.
    const persistPersons = vi.fn(() => new Promise<void>(() => {}))
    const { ctx } = renderCheckin({ ...badgeKiosk, persistPersons })
    const tap = expect(startPendingVisit()).rejects.toThrow()
    await act(() => vi.advanceTimersByTimeAsync(START_HANDOFF_TIMEOUT_MS))
    await tap
    expect(mockToastError).toHaveBeenCalledTimes(1)
    // The next tap asks instead of joining the stalled write again.
    expect(getKioskSessionState()).toMatchObject({
      autoStartPending: false,
      onCheckinScreen: true,
    })
    expect(ctx.startOver).not.toHaveBeenCalled()
  })
})

describe("CheckinRoute — Besuch starten (issue #732)", () => {
  it("starts the visit, then resets with the start-screen toast param", async () => {
    const { ctx } = renderCheckin({ isAnonymous: false, kiosk: true })
    fireEvent.click(startButton())
    await waitFor(() =>
      expect(ctx.startOver).toHaveBeenCalledWith({ startedHint: "Andrea" }),
    )
    expect(ctx.persistPersons).toHaveBeenCalledWith({ persons: linkedPersons })
    // Issue #605: companions are saved before the roster is persisted, so
    // the persisted lines carry the link.
    expect(ctx.saveCompanions).toHaveBeenCalledTimes(1)
    expect(ctx.saveCompanions.mock.invocationCallOrder[0]).toBeLessThan(
      ctx.persistPersons.mock.invocationCallOrder[0],
    )
  })

  it("stays put when the start fails (no reset)", async () => {
    const persistPersons = vi.fn().mockRejectedValue(new Error("boom"))
    const { ctx } = renderCheckin({
      isAnonymous: false,
      kiosk: true,
      persistPersons,
    })
    fireEvent.click(startButton())
    await waitFor(() => expect(persistPersons).toHaveBeenCalled())
    expect(ctx.startOver).not.toHaveBeenCalled()
  })

  it("keeps 'Besuch starten' for a purchase-only (materialbezug) checkout", () => {
    renderCheckin({
      isAnonymous: false,
      kiosk: true,
      openCheckout: { id: "c1", usageType: "materialbezug" },
    })
    expect(startButton()).toBeTruthy()
  })

  it("drops 'Besuch starten' once a visit is running", () => {
    renderCheckin({
      isAnonymous: false,
      kiosk: true,
      openCheckout: { id: "c1", usageType: "regular" },
    })
    expect(screen.queryByRole("button", { name: /Besuch starten/ })).toBeNull()
    expect(screen.getByRole("button", { name: /Material erfassen/ })).toBeTruthy()
  })
})

describe("CheckinRoute — saved persons on advance (issue #605)", () => {
  it("saves ticked companions first, persists the linked roster, then goes to /visit", async () => {
    const { ctx } = renderCheckin({ isAnonymous: false, kiosk: false })
    fireEvent.click(screen.getByRole("button", { name: /^Weiter$/ }))
    await waitFor(() => expect(mockNavigate).toHaveBeenCalled())
    expect(ctx.saveCompanions).toHaveBeenCalledTimes(1)
    expect(ctx.saveCompanions.mock.invocationCallOrder[0]).toBeLessThan(
      ctx.persistPersons.mock.invocationCallOrder[0],
    )
    expect(ctx.persistPersons).toHaveBeenCalledWith({ persons: linkedPersons })
  })

  it("stays on /checkin when the roster could not be persisted", async () => {
    const persistPersons = vi.fn().mockRejectedValue(new Error("boom"))
    renderCheckin({ isAnonymous: false, kiosk: false, persistPersons })
    fireEvent.click(screen.getByRole("button", { name: /^Weiter$/ }))
    await waitFor(() => expect(persistPersons).toHaveBeenCalled())
    expect(mockNavigate).not.toHaveBeenCalled()
  })
})

describe("CheckinRoute — start-screen toast (issue #732)", () => {
  it("shows the toast once for ?started= and strips the param", () => {
    mockSearch.current = { kiosk: "", started: "Andrea" }
    renderCheckin({ isAnonymous: true, kiosk: true })
    expect(mockToastSuccess).toHaveBeenCalledOnce()
    expect(mockToastSuccess).toHaveBeenCalledWith(
      "Besuch von Andrea gestartet. Viel Spass in der Werkstatt!",
      expect.objectContaining({ duration: 6_000 }),
    )
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/checkin",
      search: { kiosk: "" },
      replace: true,
    })
  })

  it("shows no toast without the param", () => {
    renderCheckin({ isAnonymous: true, kiosk: true })
    expect(mockToastSuccess).not.toHaveBeenCalled()
    expect(mockNavigate).not.toHaveBeenCalled()
  })
})
