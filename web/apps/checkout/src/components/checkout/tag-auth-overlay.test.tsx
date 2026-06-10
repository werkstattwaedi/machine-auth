// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * TagAuthOverlay — blocking feedback while a tapped badge is verified:
 *   - Hidden when no tag auth is in flight and no error is pending
 *   - Spinner card while `tagAuthLoading`
 *   - Error card with raw error detail + "Schliessen" on `tagAuthError`
 *   - Dismissal is keyed on `picc`: same tap stays dismissed across
 *     re-renders, a new tap (fresh picc) surfaces a new failure again
 */

import { afterEach, describe, expect, it, vi } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { TagAuthOverlay } from "./tag-auth-overlay"

const mockUseWizardContext = vi.fn()
vi.mock("./wizard-context", () => ({
  useWizardContext: () => mockUseWizardContext(),
}))

afterEach(() => {
  cleanup()
  mockUseWizardContext.mockReset()
})

describe("TagAuthOverlay", () => {
  it("renders nothing when idle", () => {
    mockUseWizardContext.mockReturnValue({
      tagAuthLoading: false,
      tagAuthError: null,
      picc: undefined,
    })
    const { container } = render(<TagAuthOverlay />)
    expect(container.firstChild).toBeNull()
  })

  it("shows the loading card while verifying", () => {
    mockUseWizardContext.mockReturnValue({
      tagAuthLoading: true,
      tagAuthError: null,
      picc: "PICC1",
    })
    render(<TagAuthOverlay />)
    expect(screen.getByRole("status")).toBeTruthy()
    expect(screen.getByText("Badge erkannt")).toBeTruthy()
  })

  it("shows the error card with detail and close button on failure", () => {
    mockUseWizardContext.mockReturnValue({
      tagAuthLoading: false,
      tagAuthError: "replay detected",
      picc: "PICC1",
    })
    render(<TagAuthOverlay />)
    expect(screen.getByRole("alertdialog")).toBeTruthy()
    expect(
      screen.getByText("Badge konnte nicht gelesen werden"),
    ).toBeTruthy()
    expect(screen.getByText("replay detected")).toBeTruthy()
    expect(
      screen.getByRole("button", { name: "Schliessen" }),
    ).toBeTruthy()
  })

  it("stays dismissed for the same picc after Schliessen", async () => {
    mockUseWizardContext.mockReturnValue({
      tagAuthLoading: false,
      tagAuthError: "verify failed",
      picc: "PICC1",
    })
    const user = userEvent.setup()
    const { container, rerender } = render(<TagAuthOverlay />)
    await user.click(screen.getByRole("button", { name: "Schliessen" }))
    expect(container.firstChild).toBeNull()
    // Unrelated re-render with the same failed tap — stays hidden.
    rerender(<TagAuthOverlay />)
    expect(container.firstChild).toBeNull()
  })

  it("surfaces a new failure after dismissal when a fresh tap arrives", async () => {
    mockUseWizardContext.mockReturnValue({
      tagAuthLoading: false,
      tagAuthError: "verify failed",
      picc: "PICC1",
    })
    const user = userEvent.setup()
    const { rerender } = render(<TagAuthOverlay />)
    await user.click(screen.getByRole("button", { name: "Schliessen" }))

    // A new physical tap mints a new picc; its verify fails too.
    mockUseWizardContext.mockReturnValue({
      tagAuthLoading: false,
      tagAuthError: "verify failed",
      picc: "PICC2",
    })
    rerender(<TagAuthOverlay />)
    expect(screen.getByRole("alertdialog")).toBeTruthy()
  })

  it("loading takes precedence over a dismissed error on re-tap", async () => {
    mockUseWizardContext.mockReturnValue({
      tagAuthLoading: false,
      tagAuthError: "verify failed",
      picc: "PICC1",
    })
    const user = userEvent.setup()
    const { rerender } = render(<TagAuthOverlay />)
    await user.click(screen.getByRole("button", { name: "Schliessen" }))

    mockUseWizardContext.mockReturnValue({
      tagAuthLoading: true,
      tagAuthError: null,
      picc: "PICC2",
    })
    rerender(<TagAuthOverlay />)
    expect(screen.getByRole("status")).toBeTruthy()
  })
})
