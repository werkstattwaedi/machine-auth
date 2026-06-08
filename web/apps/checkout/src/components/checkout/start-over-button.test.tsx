// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * StartOverButton — the anon "Von vorne beginnen" escape hatch. Self-gates on
 * `isAnonymous && openCheckout`, confirms before discarding, and calls the
 * shared `startOver` primitive (drop session + hard reload). Lives in the
 * wizard chrome so it's reachable on steps 1–3.
 *
 * Kiosk mode (issue #415): the in-page trigger is hidden (the chrome "Neuer
 * Checkout" button is the affordance), but the component still subscribes to
 * the chrome's start-over request, acks it, and opens the same confirm dialog.
 */

import { afterEach, describe, expect, it, vi } from "vitest"
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react"
import { StartOverButton } from "./start-over-button"

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

function setCtx(over: Record<string, unknown> = {}) {
  const startOver = vi.fn()
  mockUseWizardContext.mockReturnValue({
    isAnonymous: true,
    openCheckout: { id: "co1" },
    startOver,
    ...over,
  })
  return startOver
}

/** Default: no kiosk bridge (regular browser tab). */
function setBridge(over: Record<string, unknown> = {}) {
  const ackStartOver = vi.fn()
  let requestCb: (() => void) | null = null
  const onStartOverRequest = vi.fn((cb: () => void) => {
    requestCb = cb
    return () => {
      requestCb = null
    }
  })
  mockUseBridge.mockReturnValue({
    available: false,
    ackStartOver,
    onStartOverRequest,
    ...over,
  })
  return {
    ackStartOver,
    onStartOverRequest,
    fireRequest: () => act(() => requestCb?.()),
  }
}

const button = () =>
  screen.queryByRole("button", { name: /Von vorne beginnen/ })

describe("StartOverButton — gating", () => {
  it("renders nothing for a non-anonymous session", () => {
    setCtx({ isAnonymous: false })
    setBridge()
    render(<StartOverButton />)
    expect(button()).toBeNull()
  })

  it("renders nothing when there is no open checkout", () => {
    setCtx({ openCheckout: null })
    setBridge()
    render(<StartOverButton />)
    expect(button()).toBeNull()
  })

  it("renders for an anonymous session with an open checkout", () => {
    setCtx()
    setBridge()
    render(<StartOverButton />)
    expect(button()).toBeTruthy()
  })

  it("hides the in-page trigger in kiosk mode (bridge available)", () => {
    setCtx()
    setBridge({ available: true })
    render(<StartOverButton />)
    expect(button()).toBeNull()
  })
})

describe("StartOverButton — confirm flow", () => {
  it("confirming 'Verwerfen' calls startOver", () => {
    const startOver = setCtx()
    setBridge()
    render(<StartOverButton />)
    fireEvent.click(button()!)
    fireEvent.click(screen.getByRole("button", { name: "Verwerfen" }))
    expect(startOver).toHaveBeenCalledTimes(1)
  })

  it("'Abbrechen' dismisses without calling startOver", () => {
    const startOver = setCtx()
    setBridge()
    render(<StartOverButton />)
    fireEvent.click(button()!)
    fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }))
    expect(startOver).not.toHaveBeenCalled()
  })
})

describe("StartOverButton — kiosk chrome request (issue #415)", () => {
  it("opens the confirm dialog and acks when the chrome requests start-over", () => {
    setCtx()
    const bridge = setBridge({ available: true })
    render(<StartOverButton />)

    // No dialog yet, and the in-page trigger is hidden.
    expect(
      screen.queryByText("Besuch verwerfen?"),
    ).toBeNull()

    bridge.fireRequest()

    // Dialog now open + chrome acked so it cancels its fallback.
    expect(screen.getByText("Besuch verwerfen?")).toBeTruthy()
    expect(bridge.ackStartOver).toHaveBeenCalledTimes(1)
  })

  it("does not intercept the chrome request when there's nothing to discard", () => {
    setCtx({ openCheckout: null })
    const bridge = setBridge({ available: true })
    render(<StartOverButton />)
    // Subscription is skipped, so the chrome fallback (direct reset) handles it.
    expect(bridge.onStartOverRequest).not.toHaveBeenCalled()
  })
})
