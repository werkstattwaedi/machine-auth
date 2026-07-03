// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * NfcBadgeAffordance — the kiosk check-in badge box:
 *   - hero scene while the form is untouched
 *   - compact bar when collapsed (focus / typed content)
 *   - verifying state folds the former TagAuthOverlay spinner in
 *   - error state folds the failure card in; "Schliessen" dismisses
 *     keyed on picc (same tap stays dismissed, fresh tap resurfaces)
 *   - verifying takes precedence over a pending error
 */

import { afterEach, describe, expect, it } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NfcBadgeAffordance } from "./nfc-badge-affordance"

afterEach(cleanup)

const mode = () =>
  screen.getByTestId("nfc-affordance").getAttribute("data-mode")

describe("NfcBadgeAffordance", () => {
  it("shows the hero scene while the form is untouched", () => {
    render(
      <NfcBadgeAffordance collapsed={false} verifying={false} error={null} />,
    )
    expect(mode()).toBe("hero")
    expect(screen.getByText("Badge")).toBeTruthy()
    expect(screen.getByText(/an den Leser halten/)).toBeTruthy()
    expect(screen.getByText(/Um einen neuen Besuch zu starten/)).toBeTruthy()
    // The member-pricing pitch and the own-device QR moved out of the box
    // with the check-in sign-in redesign (the account section carries the
    // pitch; the QR was intentionally dropped).
    expect(screen.queryByText(/nur so gelten die Mitglieder-Preise/)).toBeNull()
    expect(screen.queryByTestId("nfc-affordance-qr")).toBeNull()
  })

  it("collapses to the compact bar when the form is in use", () => {
    render(
      <NfcBadgeAffordance collapsed verifying={false} error={null} />,
    )
    expect(mode()).toBe("compact")
    expect(
      screen.getByText("Badge an den Leser halten, um deine Daten zu laden"),
    ).toBeTruthy()
  })

  it("shows the verifying state while a tap is checked", () => {
    render(
      <NfcBadgeAffordance
        collapsed={false}
        verifying
        error={null}
        picc="PICC1"
      />,
    )
    expect(mode()).toBe("verifying")
    expect(screen.getByRole("status")).toBeTruthy()
    expect(screen.getByText("Badge erkannt")).toBeTruthy()
  })

  it("verifying takes precedence over collapsed", () => {
    render(<NfcBadgeAffordance collapsed verifying error={null} />)
    expect(mode()).toBe("verifying")
  })

  it("shows the error state with detail and Schliessen on failure", () => {
    render(
      <NfcBadgeAffordance
        collapsed={false}
        verifying={false}
        error="replay detected"
        picc="PICC1"
      />,
    )
    expect(mode()).toBe("error")
    expect(screen.getByRole("alert")).toBeTruthy()
    expect(
      screen.getByText("Badge konnte nicht gelesen werden"),
    ).toBeTruthy()
    expect(screen.getByText("replay detected")).toBeTruthy()
  })

  it("Schliessen dismisses the error back to the hero, keyed on picc", async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <NfcBadgeAffordance
        collapsed={false}
        verifying={false}
        error="verify failed"
        picc="PICC1"
      />,
    )
    await user.click(screen.getByRole("button", { name: "Schliessen" }))
    expect(mode()).toBe("hero")

    // Re-render of the same failed tap stays dismissed.
    rerender(
      <NfcBadgeAffordance
        collapsed={false}
        verifying={false}
        error="verify failed"
        picc="PICC1"
      />,
    )
    expect(mode()).toBe("hero")

    // A fresh physical tap mints a new picc — its failure surfaces again.
    rerender(
      <NfcBadgeAffordance
        collapsed={false}
        verifying={false}
        error="verify failed"
        picc="PICC2"
      />,
    )
    expect(mode()).toBe("error")
  })

  it("verifying takes precedence over a pending error on re-tap", () => {
    render(
      <NfcBadgeAffordance
        collapsed={false}
        verifying
        error="old failure"
        picc="PICC1"
      />,
    )
    expect(mode()).toBe("verifying")
  })
})
