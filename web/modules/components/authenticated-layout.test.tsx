// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, cleanup, act } from "@testing-library/react"
import { type ReactNode } from "react"
import { Shield } from "lucide-react"

// ── Mocks ──────────────────────────────────────────────────────────────

const navigateMock = vi.fn()

vi.mock("@tanstack/react-router", () => ({
  Outlet: () => <div data-testid="outlet" />,
  Link: ({ children, ...props }: { children: ReactNode } & Record<string, unknown>) => (
    <a {...(props as Record<string, string>)}>{children}</a>
  ),
  useNavigate: () => navigateMock,
  useLocation: () => ({ pathname: "/protected" }),
}))

let mockAuthReturn: Record<string, unknown> = {}

// Mock the auth module so we don't pull Firebase Auth into the test bundle.
// isProfileComplete is reproduced here with the same logic the real module
// uses; the layout's only consumer just needs the boolean answer.
vi.mock("@modules/lib/auth", () => ({
  useAuth: () => mockAuthReturn,
  isProfileComplete: (userDoc: {
    firstName?: string
    lastName?: string
    termsAcceptedAt?: unknown
    userType?: string
    billingAddress?: { line1?: string; postalCode?: string; city?: string }
  }) => {
    if (!userDoc.firstName || !userDoc.lastName || !userDoc.termsAcceptedAt) {
      return false
    }
    if (userDoc.userType === "firma") {
      const a = userDoc.billingAddress
      return Boolean(a?.line1 && a?.postalCode && a?.city)
    }
    return true
  },
}))

const { AuthenticatedLayout } = await import("./authenticated-layout")

// ── Tests ──────────────────────────────────────────────────────────────

const navItems = [{ to: "/users", label: "Benutzer", icon: Shield }]

function setupMatchMedia() {
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
}

describe("AuthenticatedLayout", () => {
  beforeEach(() => {
    setupMatchMedia()
    navigateMock.mockClear()
    mockAuthReturn = {
      user: null,
      userDoc: null,
      userDocLoading: true,
      loading: true,
      isAdmin: false,
      sessionKind: null,
      signOut: vi.fn(),
    }
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  // Regression for React error #310 (issue #107): hooks must run in the
  // same order across renders. useIsMobile/useState must sit above the
  // loading early-return so the hook count is stable.
  it("does not throw when auth transitions from loading to authenticated admin", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    const { rerender } = render(
      <AuthenticatedLayout navItems={navItems} gate={{ kind: "admin" }} />,
    )

    expect(screen.queryByText("Benutzer")).toBeNull()

    mockAuthReturn = {
      user: { uid: "admin1", email: "admin@test.com" },
      userDoc: { displayName: "Admin User" },
      userDocLoading: false,
      loading: false,
      isAdmin: true,
      sessionKind: null,
      signOut: vi.fn(),
    }

    act(() => {
      rerender(<AuthenticatedLayout navItems={navItems} gate={{ kind: "admin" }} />)
    })

    expect(screen.getByText("Benutzer")).toBeTruthy()

    const hookOrderError = errorSpy.mock.calls.find((call) =>
      String(call[0]).includes("Rendered more hooks"),
    )
    expect(hookOrderError).toBeUndefined()

    errorSpy.mockRestore()
  })

  it("admin gate redirects authenticated non-admin users to /login", () => {
    mockAuthReturn = {
      user: { uid: "u1", email: "user@test.com" },
      userDoc: { displayName: "Some User", roles: [] },
      userDocLoading: false,
      loading: false,
      isAdmin: false,
      sessionKind: null,
      signOut: vi.fn(),
    }

    render(<AuthenticatedLayout navItems={navItems} gate={{ kind: "admin" }} />)

    expect(navigateMock).toHaveBeenCalledWith({ to: "/login" })
  })

  it("member gate redirects tag-tap sessions to /", () => {
    mockAuthReturn = {
      user: { uid: "u1", email: "tag@test.com" },
      userDoc: null,
      userDocLoading: false,
      loading: false,
      isAdmin: false,
      sessionKind: "tag",
      signOut: vi.fn(),
    }

    render(
      <AuthenticatedLayout
        navItems={navItems}
        gate={{ kind: "member", completeProfilePath: "/complete-profile" }}
      />,
    )

    expect(navigateMock).toHaveBeenCalledWith({ to: "/" })
  })

  it("member gate redirects incomplete profiles to completeProfilePath", () => {
    mockAuthReturn = {
      user: { uid: "u1", email: "user@test.com" },
      // Profile missing firstName / lastName / termsAcceptedAt → incomplete.
      userDoc: { displayName: "User" },
      userDocLoading: false,
      loading: false,
      isAdmin: false,
      sessionKind: "email",
      signOut: vi.fn(),
    }

    render(
      <AuthenticatedLayout
        navItems={navItems}
        gate={{ kind: "member", completeProfilePath: "/complete-profile" }}
      />,
    )

    expect(navigateMock).toHaveBeenCalledWith({
      to: "/complete-profile",
      search: { redirect: "/protected" },
    })
  })

  it("admin gate calls the wrapper around the rendered shell", () => {
    mockAuthReturn = {
      user: { uid: "admin1", email: "admin@test.com" },
      userDoc: { displayName: "Admin" },
      userDocLoading: false,
      loading: false,
      isAdmin: true,
      sessionKind: null,
      signOut: vi.fn(),
    }

    const wrapperSpy = vi.fn(({ children }: { children: ReactNode }) => (
      <div data-testid="wrapper">{children}</div>
    ))

    render(
      <AuthenticatedLayout
        navItems={navItems}
        gate={{ kind: "admin" }}
        wrapper={wrapperSpy}
      />,
    )

    expect(wrapperSpy).toHaveBeenCalled()
    expect(screen.getByTestId("wrapper")).toBeTruthy()
    expect(screen.getByText("Benutzer")).toBeTruthy()
  })
})
