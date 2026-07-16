// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * DeniedPage — the generic /denied landing page (issue #535).
 *
 * Regression net: per-cause copy renders from the shared RejectionCause map,
 * the stale-checkout case surfaces the actionable "Besuch abschliessen" path,
 * and a signed-in user whose id differs from the encoded uid sees the mismatch
 * warning. Mirrors the capture-the-route-component pattern in checkin.test.tsx.
 */

import { describe, it, expect, vi, beforeAll, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"

// ── Capture the route component + drive its search params ────────────────
let CapturedComponent: (() => React.JSX.Element) | null = null
let searchValue: Record<string, string | undefined> = {}
const navigateMock = vi.fn()

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: { component: () => React.JSX.Element }) => {
    CapturedComponent = opts.component
    return { ...opts, useSearch: () => searchValue }
  },
  useNavigate: () => navigateMock,
}))

// ── Auth harness ─────────────────────────────────────────────────────────
const mockUseAuth = vi.fn()
vi.mock("@modules/lib/auth", () => ({
  useAuth: () => mockUseAuth(),
}))

type AuthShape = ReturnType<typeof buildAuth>
function buildAuth(opts: { userId?: string } = {}) {
  return {
    user: opts.userId ? { uid: "fbuid" } : null,
    userDoc: opts.userId ? { id: opts.userId } : null,
    sessionKind: opts.userId ? "real" : null,
    isAdmin: false,
    loading: false,
    userDocLoading: false,
  }
}

function renderDenied(
  search: Record<string, string | undefined>,
  auth: Partial<AuthShape> = buildAuth(),
) {
  searchValue = search
  mockUseAuth.mockReturnValue(auth)
  const Comp = CapturedComponent!
  return render(<Comp />)
}

beforeAll(async () => {
  await import("./denied")
})

afterEach(() => {
  cleanup()
  mockUseAuth.mockReset()
  navigateMock.mockReset()
})

describe("DeniedPage (issue #535)", () => {
  it("renders stale-checkout copy with the interpolated date + action", () => {
    renderDenied({ cause: "stale_checkout", uid: "u1", since: "2026-07-14" })

    expect(screen.getByText("Letzter Besuch noch offen")).toBeTruthy()
    expect(screen.getByText(/vom 14\.07\.2026/)).toBeTruthy()
    expect(
      screen.getByRole("button", { name: /Offenen Besuch abschliessen/ }),
    ).toBeTruthy()
    expect(screen.getByText(/direkt am Terminal/)).toBeTruthy()
  })

  it("renders missing-permission copy without the stale action", () => {
    renderDenied({ cause: "missing_permission", uid: "u1" })

    expect(screen.getByText("Berechtigung fehlt")).toBeTruthy()
    expect(
      screen.queryByRole("button", { name: /Offenen Besuch abschliessen/ }),
    ).toBeNull()
  })

  it("falls back to the generic denial for an unknown cause", () => {
    renderDenied({ cause: "bogus" })
    expect(screen.getByText("Nicht berechtigt")).toBeTruthy()
  })

  it("warns when the signed-in user differs from the encoded uid", () => {
    renderDenied(
      { cause: "stale_checkout", uid: "u1", since: "2026-07-14" },
      buildAuth({ userId: "someoneElse" }),
    )
    expect(screen.getByText(/anderen Konto/)).toBeTruthy()
  })

  it("does not warn when the signed-in user matches the encoded uid", () => {
    renderDenied(
      { cause: "stale_checkout", uid: "u1", since: "2026-07-14" },
      buildAuth({ userId: "u1" }),
    )
    expect(screen.queryByText(/anderen Konto/)).toBeNull()
  })

  it("does not warn for an anonymous / signed-out visitor", () => {
    renderDenied({ cause: "stale_checkout", uid: "u1" }, buildAuth())
    expect(screen.queryByText(/anderen Konto/)).toBeNull()
  })
})
