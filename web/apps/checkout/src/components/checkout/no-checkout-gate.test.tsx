// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * NoCheckoutGate — mounted by the wizard layout on /visit, /checkout,
 * /payment when no open checkout exists. Single-action dialog:
 *   - Always offers "Zum Check-In"
 *   - Preserves the kiosk flag when navigating
 *   - Escape key is locked (no dismiss); user must click the action
 */

import { afterEach, describe, expect, it, vi } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NoCheckoutGate } from "./no-checkout-gate"

const mockNavigate = vi.fn()
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}))

const mockUseWizardContext = vi.fn()
vi.mock("./wizard-context", () => ({
  useWizardContext: () => mockUseWizardContext(),
}))

afterEach(() => {
  cleanup()
  mockNavigate.mockReset()
  mockUseWizardContext.mockReset()
})

describe("NoCheckoutGate", () => {
  it("renders the dialog with title + action", () => {
    mockUseWizardContext.mockReturnValue({ kiosk: false })
    render(<NoCheckoutGate />)
    expect(screen.getByRole("alertdialog")).toBeTruthy()
    expect(screen.getByText("Kein offener Besuch")).toBeTruthy()
    expect(
      screen.getByRole("button", { name: "Zum Check-In" }),
    ).toBeTruthy()
  })

  it("uses the provided description override", () => {
    mockUseWizardContext.mockReturnValue({ kiosk: false })
    render(<NoCheckoutGate description="Custom message here" />)
    expect(screen.getByText("Custom message here")).toBeTruthy()
  })

  it("navigates to /checkin when the action is clicked", async () => {
    mockUseWizardContext.mockReturnValue({ kiosk: false })
    const user = userEvent.setup()
    render(<NoCheckoutGate />)
    await user.click(screen.getByRole("button", { name: "Zum Check-In" }))
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/checkin",
      search: {},
    })
  })

  it("preserves the kiosk flag when navigating", async () => {
    mockUseWizardContext.mockReturnValue({ kiosk: true })
    const user = userEvent.setup()
    render(<NoCheckoutGate />)
    await user.click(screen.getByRole("button", { name: "Zum Check-In" }))
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/checkin",
      search: { kiosk: "" },
    })
  })
})
