// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * `/checkout/<checkoutId>` — the stale-open-checkout reminder landing route
 * (#531). It must route the email recipient correctly whatever session the
 * link opens in:
 *
 *   - no session → bounce through /login with a redirect back here
 *   - owner signed in → hand off to the root dispatcher (`/`)
 *   - a *different* member signed in (checkout unreadable) → "wrong account"
 *     hint using the id, not a blank screen
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, cleanup, waitFor } from "@testing-library/react"

const CHECKOUT_ID = "co-abc123"

// ── Capture the route component + stub router primitives ─────────────────
let CapturedComponent: (() => React.JSX.Element) | null = null
const mockNavigate = vi.fn()
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: { component: () => React.JSX.Element }) => {
    CapturedComponent = opts.component
    return { ...opts, useParams: () => ({ checkoutId: CHECKOUT_ID }) }
  },
  useNavigate: () => mockNavigate,
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}))

// Button pulls in Radix Slot; render its children directly for this test.
vi.mock("@modules/components/ui/button", () => ({
  Button: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

const mockUseAuth = vi.fn()
vi.mock("@modules/lib/auth", () => ({ useAuth: () => mockUseAuth() }))

const mockUseDocument = vi.fn()
vi.mock("@modules/lib/firestore", () => ({
  useDocument: (...args: unknown[]) => mockUseDocument(...args),
}))

vi.mock("@modules/lib/firebase-context", () => ({ useDb: () => ({}) }))
vi.mock("@modules/lib/firestore-helpers", () => ({
  checkoutRef: () => ({ path: `checkouts/${CHECKOUT_ID}` }),
}))

function renderRoute() {
  // Import triggers createFileRoute -> captures the component.
  return import("./checkout.$checkoutId").then(() => {
    if (!CapturedComponent) throw new Error("route component not captured")
    return render(<CapturedComponent />)
  })
}

beforeEach(() => {
  mockNavigate.mockClear()
  mockUseAuth.mockReset()
  mockUseDocument.mockReset()
})

afterEach(() => cleanup())

describe("/checkout/$checkoutId", () => {
  it("bounces an unauthenticated visitor to /login with a redirect back", async () => {
    mockUseAuth.mockReturnValue({
      user: null,
      userDoc: null,
      loading: false,
      userDocLoading: false,
      sessionKind: null,
    })
    mockUseDocument.mockReturnValue({ data: null, loading: false, error: null })

    await renderRoute()

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/login",
        search: { redirect: `/checkout/${CHECKOUT_ID}` },
      }),
    )
  })

  it("hands the owner off to the root dispatcher", async () => {
    mockUseAuth.mockReturnValue({
      user: { uid: "fb-1", isAnonymous: false },
      userDoc: { id: "u1" },
      loading: false,
      userDocLoading: false,
      sessionKind: "real",
    })
    mockUseDocument.mockReturnValue({
      data: { id: CHECKOUT_ID, userId: { id: "u1" }, status: "open" },
      loading: false,
      error: null,
    })

    await renderRoute()

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith({ to: "/" }),
    )
  })

  it("shows the wrong-account hint when the checkout is unreadable (different member)", async () => {
    mockUseAuth.mockReturnValue({
      user: { uid: "fb-2", isAnonymous: false },
      userDoc: { id: "u2" },
      loading: false,
      userDocLoading: false,
      sessionKind: "real",
    })
    // A non-owner can't read the owner's checkout → permission error.
    mockUseDocument.mockReturnValue({
      data: null,
      loading: false,
      error: new Error("permission-denied"),
    })

    await renderRoute()

    expect(await screen.findByText("Anderes Konto")).toBeTruthy()
    // Must not silently forward the wrong user into the dispatcher.
    expect(mockNavigate).not.toHaveBeenCalledWith({ to: "/" })
  })
})
