// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * useBounceIfNoCheckout — QR-deep-link guard for /visit/add/* sub-routes.
 *
 * Contract:
 *   - With an open checkout: no-op.
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

function Probe() {
  useBounceIfNoCheckout()
  return null
}

afterEach(() => {
  cleanup()
  mockNavigate.mockReset()
  mockUseWizardContext.mockReset()
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
