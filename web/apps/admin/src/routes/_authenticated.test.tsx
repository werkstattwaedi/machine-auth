// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react"
import { type ReactNode } from "react"

// ── Mocks ──────────────────────────────────────────────────────────────

// Capture the component passed to createFileRoute
let CapturedComponent: (() => React.JSX.Element) | null = null
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: { component: () => React.JSX.Element }) => {
    CapturedComponent = opts.component
    return opts
  },
  Outlet: () => null,
  Link: ({ children, ...props }: { children: ReactNode } & Record<string, unknown>) => (
    <a {...(props as Record<string, string>)}>{children}</a>
  ),
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: "/" }),
}))

// Avoid pulling in Firestore via LookupProvider
vi.mock("@modules/lib/lookup", () => ({
  LookupProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

let mockAuthReturn: Record<string, unknown> = {
  user: null,
  userDoc: null,
  userDocLoading: true,
  loading: true,
  isAdmin: false,
  signOut: vi.fn(),
}

vi.mock("@modules/lib/auth", () => ({
  useAuth: () => mockAuthReturn,
}))

// A built bundle's version — the chrome must not show it (#729).
vi.mock("@modules/lib/build-version", () => ({ BUILD_VERSION: "2026.10.3" }))

await import("./_authenticated")

// ── Tests ──────────────────────────────────────────────────────────────

describe("AdminAuthenticatedLayout", () => {
  beforeEach(() => {
    // jsdom does not implement matchMedia
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      onchange: null,
      dispatchEvent: vi.fn(),
    }))

    mockAuthReturn = {
      user: null,
      userDoc: null,
      userDocLoading: true,
      loading: true,
      isAdmin: false,
      signOut: vi.fn(),
    }
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  // Regression test for React error #310 (issue #107): hooks must be called in
  // the same order when auth transitions from loading to resolved. Previously
  // useIsMobile() and useState() sat below the `if (loading) return ...` early
  // return, so the second render called more hooks than the first and React
  // threw "Rendered more hooks than during the previous render."
  it("does not throw when auth transitions from loading to authenticated admin", () => {
    const Component = CapturedComponent!
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    const { rerender } = render(<Component />)

    expect(screen.queryByText("Personen")).toBeNull()

    mockAuthReturn = {
      user: { uid: "admin1", email: "admin@test.com" },
      userDoc: { name: "Admin User" },
      userDocLoading: false,
      loading: false,
      isAdmin: true,
      signOut: vi.fn(),
    }

    act(() => {
      rerender(<Component />)
    })

    expect(screen.getByText("Personen")).toBeTruthy()

    const hookOrderError = errorSpy.mock.calls.find((call) =>
      String(call[0]).includes("Rendered more hooks"),
    )
    expect(hookOrderError).toBeUndefined()

    errorSpy.mockRestore()
  })

  // Issue #669 / #729: the Marker.io launcher is hidden in production, so
  // the header menu offers the capture; the sidebar footer with the
  // (truncated) version is gone.
  it("offers Problem melden in the header menu, without a version footer", async () => {
    const capture = vi.fn()
    window.__Marker = {}
    window.Marker = { capture }
    mockAuthReturn = {
      user: { uid: "admin1", email: "admin@test.com" },
      userDoc: { name: "Admin User" },
      userDocLoading: false,
      loading: false,
      isAdmin: true,
      signOut: vi.fn(),
    }
    const Component = CapturedComponent!
    render(<Component />)

    expect(screen.queryByText(/2026\.10\.3/)).toBeNull()
    expect(screen.queryByRole("button", { name: "Problem melden" })).toBeNull()

    // Radix opens the dropdown on keyboard activation (no user-event here).
    fireEvent.keyDown(screen.getByRole("button", { name: "Konto-Menü" }), {
      key: "Enter",
    })
    await screen.findByRole("menu")
    expect(screen.getAllByRole("menuitem").map((el) => el.textContent)).toEqual([
      "Problem melden",
      "Abmelden",
    ])
    fireEvent.click(screen.getByRole("menuitem", { name: "Problem melden" }))
    expect(capture).toHaveBeenCalledWith("fullscreen")
    delete window.Marker
    delete window.__Marker
  })
})
