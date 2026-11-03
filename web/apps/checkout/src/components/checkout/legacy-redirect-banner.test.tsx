// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { HELP_URL, WHATS_NEW_URL } from "@/lib/help-links"
import { LegacyRedirectBanner } from "./legacy-redirect-banner"

const mockUseWizardContext = vi.fn()
vi.mock("./wizard-context", () => ({
  useWizardContext: () => mockUseWizardContext(),
}))

const mockUseBridge = vi.fn()
vi.mock("@modules/lib/use-bridge", () => ({
  useBridge: () => mockUseBridge(),
}))

afterEach(() => {
  cleanup()
  mockUseWizardContext.mockReset()
  mockUseBridge.mockReset()
})

function renderBanner({
  kiosk = false,
  bridgeAvailable = false,
  ...over
}: { from?: string; kiosk?: boolean; bridgeAvailable?: boolean } = {}) {
  // `in`, not a default: `from: undefined` is a case under test.
  const from = "from" in over ? over.from : "legacy"
  mockUseWizardContext.mockReturnValue({ kiosk })
  mockUseBridge.mockReturnValue({ available: bridgeAvailable })
  const onDismiss = vi.fn()
  render(<LegacyRedirectBanner from={from} onDismiss={onDismiss} />)
  return { onDismiss }
}

describe("LegacyRedirectBanner", () => {
  it("links to what is new and the Anleitung in new tabs", () => {
    renderBanner()
    const links = screen.getAllByRole("link")
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      WHATS_NEW_URL,
      HELP_URL,
    ])
    for (const a of links) expect(a).toHaveAttribute("target", "_blank")
  })

  it("calls onDismiss when closed", () => {
    const { onDismiss } = renderBanner()
    fireEvent.click(screen.getByRole("button", { name: "Schliessen" }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it.each([undefined, "", "other"])("stays hidden for from=%s", (from) => {
    renderBanner({ from })
    expect(screen.queryByTestId("legacy-redirect-banner")).toBeNull()
  })

  it("stays hidden on a ?kiosk page", () => {
    renderBanner({ kiosk: true })
    expect(screen.queryByTestId("legacy-redirect-banner")).toBeNull()
  })

  it("stays hidden under the kiosk bridge even without the kiosk flag", () => {
    renderBanner({ bridgeAvailable: true })
    expect(screen.queryByTestId("legacy-redirect-banner")).toBeNull()
  })
})
