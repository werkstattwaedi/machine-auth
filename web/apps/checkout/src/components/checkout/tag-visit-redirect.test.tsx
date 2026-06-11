// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * TagVisitRedirect — forwards a tag-identified user with an open checkout
 * from /checkin to /visit (or /checkout when stale), mirroring the "/"
 * dispatcher for the kiosk's direct-to-/checkin tap path:
 *   - waits for the open-checkout query to resolve before deciding
 *   - decides once per identified user: a checkout created LATER on this
 *     terminal ("Besuch starten") must not trigger a bounce
 *   - preserves picc/cmac/kiosk on the redirect
 */

import { afterEach, describe, expect, it, vi } from "vitest"
import { render, cleanup } from "@testing-library/react"
import { TagVisitRedirect } from "./tag-visit-redirect"

const mockNavigate = vi.fn()
let mockPathname = "/checkin"
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname: mockPathname }),
}))

const mockUseWizardContext = vi.fn()
vi.mock("./wizard-context", () => ({
  useWizardContext: () => mockUseWizardContext(),
}))

afterEach(() => {
  cleanup()
  mockNavigate.mockReset()
  mockUseWizardContext.mockReset()
  mockPathname = "/checkin"
})

function ctx(overrides: Record<string, unknown> = {}) {
  return {
    isTagIdentified: true,
    identifiedUserRef: { id: "user-1" },
    openCheckout: null,
    openCheckoutLoading: false,
    picc: "P1",
    cmac: "C1",
    kiosk: true,
    ...overrides,
  }
}

function todayCheckout(id = "co-1") {
  return { id, created: { toDate: () => new Date() } }
}

describe("TagVisitRedirect", () => {
  it("forwards to /visit when the tag user has an open checkout from today", () => {
    mockUseWizardContext.mockReturnValue(
      ctx({ openCheckout: todayCheckout() }),
    )
    render(<TagVisitRedirect />)
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/visit",
      search: { picc: "P1", cmac: "C1", kiosk: "" },
      replace: true,
    })
  })

  it("forwards to /checkout when the open checkout is stale", () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
    mockUseWizardContext.mockReturnValue(
      ctx({
        openCheckout: { id: "co-1", created: { toDate: () => twoDaysAgo } },
      }),
    )
    render(<TagVisitRedirect />)
    expect(mockNavigate).toHaveBeenCalledWith(
      expect.objectContaining({ to: "/checkout" }),
    )
  })

  it("waits while the open-checkout query is still loading", () => {
    mockUseWizardContext.mockReturnValue(
      ctx({ openCheckout: null, openCheckoutLoading: true }),
    )
    const { rerender } = render(<TagVisitRedirect />)
    expect(mockNavigate).not.toHaveBeenCalled()

    // Query resolves WITH a checkout — now it forwards.
    mockUseWizardContext.mockReturnValue(
      ctx({ openCheckout: todayCheckout(), openCheckoutLoading: false }),
    )
    rerender(<TagVisitRedirect />)
    expect(mockNavigate).toHaveBeenCalledOnce()
  })

  it("never fires for a checkout created after the decision (Besuch starten)", () => {
    // First resolution: no open checkout → decision latched as "stay".
    mockUseWizardContext.mockReturnValue(ctx({ openCheckout: null }))
    const { rerender } = render(<TagVisitRedirect />)
    expect(mockNavigate).not.toHaveBeenCalled()

    // The user creates a checkout on this terminal — no bounce.
    mockUseWizardContext.mockReturnValue(
      ctx({ openCheckout: todayCheckout("co-new") }),
    )
    rerender(<TagVisitRedirect />)
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it("redirects again when a different badge identifies a new user", () => {
    mockUseWizardContext.mockReturnValue(
      ctx({ openCheckout: todayCheckout() }),
    )
    const { rerender } = render(<TagVisitRedirect />)
    expect(mockNavigate).toHaveBeenCalledTimes(1)

    mockUseWizardContext.mockReturnValue(
      ctx({
        identifiedUserRef: { id: "user-2" },
        openCheckout: todayCheckout("co-2"),
      }),
    )
    rerender(<TagVisitRedirect />)
    expect(mockNavigate).toHaveBeenCalledTimes(2)
  })

  it("does nothing for anonymous sessions", () => {
    mockUseWizardContext.mockReturnValue(
      ctx({
        isTagIdentified: false,
        identifiedUserRef: null,
        openCheckout: todayCheckout(),
      }),
    )
    render(<TagVisitRedirect />)
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it("does not navigate when already past /checkin", () => {
    mockPathname = "/visit"
    mockUseWizardContext.mockReturnValue(
      ctx({ openCheckout: todayCheckout() }),
    )
    render(<TagVisitRedirect />)
    expect(mockNavigate).not.toHaveBeenCalled()
  })
})
