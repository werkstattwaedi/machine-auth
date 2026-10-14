// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * useBounceIfNoCheckout — QR-deep-link guard for /visit/add/* sub-routes.
 *
 * Contract:
 *   - With an open checkout: no-op.
 *   - While auth or the open-checkout query is still loading: no-op (a
 *     cold reload must not read "not loaded yet" as "no checkout").
 *   - With no checkout but pendingCheckout=true: no-op (a fresh doc was
 *     just written; the onSnapshot listener hasn't surfaced it yet).
 *   - With no checkout and pendingCheckout=false: navigate to /checkin
 *     with `rescan=1` (and kiosk param if applicable).
 *   - Fires at most once per mount (latch).
 */

import { afterEach, describe, expect, it, vi } from "vitest"
import { render, cleanup } from "@testing-library/react"
import { useBounceIfNoCheckout } from "./use-bounce-if-no-checkout"

const mockNavigate = vi.fn()
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}))

const mockUseWizardContext = vi.fn()
vi.mock("./wizard-context", () => ({
  useWizardContext: () => mockUseWizardContext(),
}))

const mockUseAuth = vi.fn(() => ({ loading: false }))
vi.mock("@modules/lib/auth", () => ({
  useAuth: () => mockUseAuth(),
}))

function Probe() {
  useBounceIfNoCheckout()
  return null
}

afterEach(() => {
  cleanup()
  mockNavigate.mockReset()
  mockUseWizardContext.mockReset()
  mockUseAuth.mockReset()
  mockUseAuth.mockReturnValue({ loading: false })
})

describe("useBounceIfNoCheckout", () => {
  it("does nothing when an open checkout exists", () => {
    mockUseWizardContext.mockReturnValue({
      openCheckout: { id: "co1" },
      pendingCheckout: false,
      kiosk: false,
    })
    render(<Probe />)
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it("does nothing while pendingCheckout is true (write hasn't propagated)", () => {
    mockUseWizardContext.mockReturnValue({
      openCheckout: null,
      pendingCheckout: true,
      kiosk: false,
    })
    render(<Probe />)
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it("does nothing while the open-checkout query is still loading", () => {
    mockUseWizardContext.mockReturnValue({
      openCheckout: null,
      openCheckoutLoading: true,
      pendingCheckout: false,
      kiosk: false,
    })
    render(<Probe />)
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it("does nothing while auth is still restoring", () => {
    mockUseAuth.mockReturnValue({ loading: true })
    mockUseWizardContext.mockReturnValue({
      openCheckout: null,
      openCheckoutLoading: false,
      pendingCheckout: false,
      kiosk: false,
    })
    render(<Probe />)
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it("stays put once a loading query surfaces the open checkout", () => {
    mockUseWizardContext.mockReturnValue({
      openCheckout: null,
      openCheckoutLoading: true,
      pendingCheckout: false,
      kiosk: false,
    })
    const { rerender } = render(<Probe />)
    mockUseWizardContext.mockReturnValue({
      openCheckout: { id: "co1" },
      openCheckoutLoading: false,
      pendingCheckout: false,
      kiosk: false,
    })
    rerender(<Probe />)
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it("navigates to /checkin with rescan=1 when no checkout exists", () => {
    mockUseWizardContext.mockReturnValue({
      openCheckout: null,
      pendingCheckout: false,
      kiosk: false,
    })
    render(<Probe />)
    expect(mockNavigate).toHaveBeenCalledOnce()
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/checkin",
      search: { rescan: "1" },
    })
  })

  it("preserves the kiosk flag when bouncing", () => {
    mockUseWizardContext.mockReturnValue({
      openCheckout: null,
      pendingCheckout: false,
      kiosk: true,
    })
    render(<Probe />)
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/checkin",
      search: { kiosk: "", rescan: "1" },
    })
  })
})
