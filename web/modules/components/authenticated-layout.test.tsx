// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react"
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
      userDoc: { name: "Admin User" },
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

  // Regression for issue #558: a signed-in non-admin used to be bounced to
  // /login, which redirected right back to the protected route — an endless
  // loop with no message. The admin gate must now render a terminal
  // "Kein Admin-Zugriff" state and NOT navigate anywhere (no loop). The
  // sign-out button is the only escape and must call signOut().
  it("admin gate shows a terminal no-access state for non-admins instead of looping", () => {
    const signOutMock = vi.fn()
    mockAuthReturn = {
      user: { uid: "u1", email: "user@test.com" },
      userDoc: { name: "Some User", roles: [] },
      userDocLoading: false,
      loading: false,
      isAdmin: false,
      sessionKind: "real",
      signOut: signOutMock,
    }

    render(<AuthenticatedLayout navItems={navItems} gate={{ kind: "admin" }} />)

    // Terminal message shown, protected chrome NOT rendered.
    expect(screen.getByText("Kein Admin-Zugriff")).toBeTruthy()
    expect(screen.getByText("user@test.com")).toBeTruthy()
    expect(screen.queryByText("Benutzer")).toBeNull()

    // Crucially: no redirect fired — this is what broke the /login ↔ guard loop.
    expect(navigateMock).not.toHaveBeenCalled()

    // The only affordance is sign-out; clicking it signs the user out (after
    // which `user` flips to null and the unauth effect takes them to /login).
    const button = screen.getByRole("button", { name: "Abmelden" })
    fireEvent.click(button)
    expect(signOutMock).toHaveBeenCalledTimes(1)
  })

  // While the user doc is still loading, isAdmin is transiently false; the
  // gate must NOT flash the no-access state for a legitimate admin.
  it("admin gate waits for the user doc before judging non-admins", () => {
    mockAuthReturn = {
      user: { uid: "u1", email: "user@test.com" },
      userDoc: null,
      userDocLoading: true,
      loading: false,
      isAdmin: false,
      sessionKind: "real",
      signOut: vi.fn(),
    }

    render(<AuthenticatedLayout navItems={navItems} gate={{ kind: "admin" }} />)

    expect(screen.queryByText("Kein Admin-Zugriff")).toBeNull()
    expect(navigateMock).not.toHaveBeenCalled()
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
        gate={{ kind: "member", completeProfilePath: "/account/complete-profile" }}
      />,
    )

    expect(navigateMock).toHaveBeenCalledWith({ to: "/" })
  })

  it("member gate redirects incomplete profiles to completeProfilePath", () => {
    mockAuthReturn = {
      user: { uid: "u1", email: "user@test.com" },
      // Profile missing firstName / lastName / termsAcceptedAt → incomplete.
      userDoc: { name: "User" },
      userDocLoading: false,
      loading: false,
      isAdmin: false,
      sessionKind: "email",
      signOut: vi.fn(),
    }

    render(
      <AuthenticatedLayout
        navItems={navItems}
        gate={{ kind: "member", completeProfilePath: "/account/complete-profile" }}
      />,
    )

    expect(navigateMock).toHaveBeenCalledWith({
      to: "/account/complete-profile",
      search: { redirect: "/protected" },
    })
  })

  // Regression for issue #179: an eager-anon principal (Firebase
  // signInAnonymously, used by the no-account checkout flow) must NOT be
  // allowed to reach member-area routes like /visit. The layout should
  // redirect to /login with a ?redirect=<pathname> search param so a
  // successful upgrade lands them back where they started, and the
  // navigation chrome must not render even for one frame.
  it("redirects anonymous member-area users to /login with redirect search param", () => {
    mockAuthReturn = {
      user: { uid: "anon1", email: null, isAnonymous: true },
      userDoc: null,
      userDocLoading: false,
      loading: false,
      isAdmin: false,
      sessionKind: "anonymous",
      signOut: vi.fn(),
    }

    render(
      <AuthenticatedLayout
        navItems={navItems}
        gate={{ kind: "member", completeProfilePath: "/account/complete-profile" }}
      />,
    )

    expect(navigateMock).toHaveBeenCalledWith({
      to: "/login",
      search: { redirect: "/protected" },
    })
    // Chrome must not render — no nav item label, no sign-out button.
    expect(screen.queryByText("Benutzer")).toBeNull()
    expect(screen.queryByRole("button", { name: "Abmelden" })).toBeNull()
  })

  // Regression for issue #232: the "Abmelden" button is now icon-only,
  // collapsed into the avatar row so the leading edges align. The visible
  // text was removed, so screen readers and tests rely on `aria-label`.
  // Verifies both that the accessible name is wired up and that clicking
  // the icon-only button still calls signOut().
  it("renders sign-out as an icon-only button with accessible name 'Abmelden'", () => {
    const signOutMock = vi.fn()
    mockAuthReturn = {
      user: { uid: "u1", email: "user@test.com" },
      userDoc: { name: "User" },
      userDocLoading: false,
      loading: false,
      isAdmin: true,
      sessionKind: null,
      signOut: signOutMock,
    }

    render(<AuthenticatedLayout navItems={navItems} gate={{ kind: "admin" }} />)

    // Visible text label is gone — the icon button exposes its name via aria-label.
    expect(screen.queryByText("Abmelden")).toBeNull()
    const button = screen.getByRole("button", { name: "Abmelden" })
    expect(button).toBeTruthy()

    fireEvent.click(button)
    expect(signOutMock).toHaveBeenCalledTimes(1)
  })

  it("admin gate calls the wrapper around the rendered shell", () => {
    mockAuthReturn = {
      user: { uid: "admin1", email: "admin@test.com" },
      userDoc: { name: "Admin" },
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
