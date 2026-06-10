// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * PaymentRoute — reset dispatch of the completion dialog's primary CTA:
 *   - Logged-in users get the soft resetWizard (they stay signed in)
 *   - Kiosk/anonymous users get startOver — the same strong wipe as the
 *     Electron chrome's "Neuer Checkout" (signOut + bridge partition wipe
 *     + hard reload). The soft reset used to leave the in-memory Firebase
 *     session alive after the partition wipe, so the next visitor saw
 *     leftovers of the previous session.
 */

import { describe, it, expect, vi, beforeAll, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

// ── Capture the route component (mirrors visit.test.tsx) ─────────────────
let CapturedComponent: (() => React.JSX.Element) | null = null
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: { component: () => React.JSX.Element }) => {
    CapturedComponent = opts.component
    return opts
  },
  useNavigate: () => vi.fn(),
}))

const mockUseWizardContext = vi.fn()
vi.mock("@/components/checkout/wizard-context", () => ({
  useWizardContext: () => mockUseWizardContext(),
}))

// The payment widget itself is irrelevant here — stub it out.
vi.mock("@/components/checkout/payment-result", () => ({
  PaymentResult: () => null,
}))

// Surface the dialog's primary CTA as a plain button so the test can
// exercise the route's onNewVisit dispatch without dialog plumbing.
vi.mock("@/components/checkout/completion-dialog", () => ({
  CompletionDialog: ({ onNewVisit }: { onNewVisit: () => void }) => (
    <button onClick={onNewVisit}>new-visit</button>
  ),
}))

// Static imports are hoisted above the `let CapturedComponent` binding
// (TDZ crash) — load the route module after module init instead.
beforeAll(async () => {
  await import("./payment")
})

function baseContext(overrides: Record<string, unknown> = {}) {
  return {
    paymentData: { checkoutId: "c1" },
    totalPrice: 12,
    isMember: false,
    kiosk: true,
    isAccountLoggedIn: false,
    resetWizard: vi.fn().mockResolvedValue(undefined),
    startOver: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

afterEach(() => {
  cleanup()
  mockUseWizardContext.mockReset()
})

describe("PaymentRoute reset dispatch", () => {
  it("kiosk/anonymous completion uses the strong startOver wipe", async () => {
    const ctx = baseContext()
    mockUseWizardContext.mockReturnValue(ctx)
    const user = userEvent.setup()
    const PaymentRoute = CapturedComponent!
    render(<PaymentRoute />)

    await user.click(screen.getByRole("button", { name: "new-visit" }))
    expect(ctx.startOver).toHaveBeenCalledOnce()
    expect(ctx.resetWizard).not.toHaveBeenCalled()
  })

  it("logged-in completion keeps the session via soft resetWizard", async () => {
    const ctx = baseContext({ isAccountLoggedIn: true, kiosk: false })
    mockUseWizardContext.mockReturnValue(ctx)
    const user = userEvent.setup()
    const PaymentRoute = CapturedComponent!
    render(<PaymentRoute />)

    await user.click(screen.getByRole("button", { name: "new-visit" }))
    expect(ctx.resetWizard).toHaveBeenCalledOnce()
    expect(ctx.startOver).not.toHaveBeenCalled()
  })
})
