// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * useBounceIfNoCheckout — layout-mounted guard for cold QR deep links
 * (issue #664).
 *
 * Contract:
 *   - No intent (path carries no add target): no-op, returns false.
 *   - With an open or pending checkout: no-op, returns false.
 *   - Cold (intent, no checkout): returns true; navigates to /checkin with
 *     `next=<scanned path>` (plus the kiosk flag), replacing the entry —
 *     but only once the principal and its open-checkout query have
 *     resolved, so a running visit is never misread as "none".
 *   - Fires once per cold path, again for a different one.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { render, cleanup } from "@testing-library/react"
import type { RouteIntent } from "@/lib/parse-checkout-qr"
import { useBounceIfNoCheckout } from "./use-bounce-if-no-checkout"

const mockNavigate = vi.fn()
let pathname = "/visit/add/list/abc"
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname }),
}))

const mockUseAuth = vi.fn()
vi.mock("@modules/lib/auth", () => ({
  useAuth: () => mockUseAuth(),
}))

const mockUseWizardContext = vi.fn()
vi.mock("./wizard-context", () => ({
  useWizardContext: () => mockUseWizardContext(),
}))

const LIST_INTENT: RouteIntent = { kind: "list", listId: "abc" }

const results: boolean[] = []
function Probe({ intent }: { intent: RouteIntent | null }) {
  results.push(useBounceIfNoCheckout(intent))
  return null
}

function ctx(overrides: Record<string, unknown> = {}) {
  return {
    openCheckout: null,
    openCheckoutLoading: false,
    pendingCheckout: false,
    tagAuthLoading: false,
    kiosk: false,
    ...overrides,
  }
}

function authState(overrides: Record<string, unknown> = {}) {
  return {
    loading: false,
    userDocLoading: false,
    sessionKind: null,
    ...overrides,
  }
}

beforeEach(() => {
  pathname = "/visit/add/list/abc"
  results.length = 0
  mockUseAuth.mockReturnValue(authState())
  mockUseWizardContext.mockReturnValue(ctx())
})

afterEach(() => {
  cleanup()
  mockNavigate.mockReset()
  mockUseAuth.mockReset()
  mockUseWizardContext.mockReset()
})

describe("useBounceIfNoCheckout", () => {
  it("does nothing without an intent (path carries no add target)", () => {
    pathname = "/visit"
    render(<Probe intent={null} />)
    expect(mockNavigate).not.toHaveBeenCalled()
    expect(results.at(-1)).toBe(false)
  })

  it("does nothing when an open checkout exists", () => {
    mockUseWizardContext.mockReturnValue(ctx({ openCheckout: { id: "co1" } }))
    render(<Probe intent={LIST_INTENT} />)
    expect(mockNavigate).not.toHaveBeenCalled()
    expect(results.at(-1)).toBe(false)
  })

  it("does nothing while pendingCheckout is true (write hasn't propagated)", () => {
    mockUseWizardContext.mockReturnValue(ctx({ pendingCheckout: true }))
    render(<Probe intent={LIST_INTENT} />)
    expect(mockNavigate).not.toHaveBeenCalled()
    expect(results.at(-1)).toBe(false)
  })

  it("carries the scanned path to /checkin as `next`", () => {
    render(<Probe intent={LIST_INTENT} />)
    expect(mockNavigate).toHaveBeenCalledOnce()
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/checkin",
      search: { next: "/visit/add/list/abc" },
      replace: true,
    })
    expect(results.at(-1)).toBe(true)
  })

  it("preserves the kiosk flag when bouncing", () => {
    mockUseWizardContext.mockReturnValue(ctx({ kiosk: true }))
    render(<Probe intent={LIST_INTENT} />)
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/checkin",
      search: { kiosk: "", next: "/visit/add/list/abc" },
      replace: true,
    })
  })

  // A fresh page load renders before the session is restored and before the
  // open-checkout query answers; bouncing then would throw a visitor with a
  // running visit back to the check-in.
  it.each([
    ["the open-checkout query", () => mockUseWizardContext.mockReturnValue(ctx({ openCheckoutLoading: true }))],
    ["Firebase Auth", () => mockUseAuth.mockReturnValue(authState({ loading: true }))],
    ["the member's user doc", () => mockUseAuth.mockReturnValue(authState({ sessionKind: "real", userDocLoading: true }))],
    ["a badge verification", () => mockUseWizardContext.mockReturnValue(ctx({ tagAuthLoading: true }))],
  ])("waits for %s before deciding", (_label, arrange) => {
    arrange()
    const { rerender } = render(<Probe intent={LIST_INTENT} />)
    expect(mockNavigate).not.toHaveBeenCalled()
    // Still a cold deep link as far as the layout is concerned: spinner,
    // not the "Kein offener Besuch" dialog.
    expect(results.at(-1)).toBe(true)

    // Resolved with a running visit → stays on the picker.
    mockUseAuth.mockReturnValue(authState({ sessionKind: "real" }))
    mockUseWizardContext.mockReturnValue(ctx({ openCheckout: { id: "co1" } }))
    rerender(<Probe intent={LIST_INTENT} />)
    expect(mockNavigate).not.toHaveBeenCalled()
    expect(results.at(-1)).toBe(false)
  })

  it("bounces once the pending lookups resolve without a checkout", () => {
    mockUseWizardContext.mockReturnValue(ctx({ openCheckoutLoading: true }))
    const { rerender } = render(<Probe intent={LIST_INTENT} />)
    expect(mockNavigate).not.toHaveBeenCalled()

    mockUseWizardContext.mockReturnValue(ctx())
    rerender(<Probe intent={LIST_INTENT} />)
    expect(mockNavigate).toHaveBeenCalledOnce()
  })

  it("fires once per cold path, and again for a different one", () => {
    const { rerender } = render(<Probe intent={LIST_INTENT} />)
    rerender(<Probe intent={LIST_INTENT} />)
    expect(mockNavigate).toHaveBeenCalledOnce()

    // The redirect landed on /checkin (no intent there) …
    pathname = "/checkin"
    rerender(<Probe intent={null} />)
    // … and the visitor scans another code without having checked in.
    pathname = "/visit/add/item/3210"
    rerender(<Probe intent={{ kind: "item", code: "3210" }} />)
    expect(mockNavigate).toHaveBeenCalledTimes(2)
    expect(mockNavigate).toHaveBeenLastCalledWith({
      to: "/checkin",
      search: { next: "/visit/add/item/3210" },
      replace: true,
    })
  })
})
