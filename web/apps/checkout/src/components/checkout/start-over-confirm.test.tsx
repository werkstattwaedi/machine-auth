// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * "Von vorne beginnen" — the anon escape hatch. Since #729 the trigger is an
 * entry of the anonymous header menu (`useStartOverMenuEntry`) and the confirm
 * dialog (`StartOverConfirm`) stays mounted in the wizard chrome. Both gate on
 * `isAnonymous && openCheckout`; confirming calls the shared `startOver`
 * primitive (drop session + hard reload).
 *
 * Kiosk mode (issue #415): there is no in-page entry (the chrome "Neuer
 * Checkout" button is the affordance), but the dialog still subscribes to the
 * chrome's start-over request, acks it, and opens.
 */

import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  render,
  renderHook,
  screen,
  cleanup,
  fireEvent,
  act,
} from "@testing-library/react"
import { StartOverConfirm } from "./start-over-confirm"
import { useStartOverMenuEntry } from "./start-over-menu-entry"

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

function entry(onRequest = vi.fn()) {
  return renderHook(() => useStartOverMenuEntry(onRequest)).result.current
}

/** The chrome's wiring: menu entry opens the always-mounted dialog. */
function Harness() {
  const [open, setOpen] = useState(false)
  const item = useStartOverMenuEntry(() => setOpen(true))
  return (
    <>
      {item && (
        <button type="button" onClick={item.onSelect}>
          {item.label}
        </button>
      )}
      <StartOverConfirm open={open} onOpenChange={setOpen} />
    </>
  )
}

const button = () =>
  screen.queryByRole("button", { name: /Von vorne beginnen/ })

describe("useStartOverMenuEntry — gating", () => {
  it("is null for a non-anonymous session", () => {
    setCtx({ isAnonymous: false })
    setBridge()
    expect(entry()).toBeNull()
  })

  it("is null when there is no open checkout", () => {
    setCtx({ openCheckout: null })
    setBridge()
    expect(entry()).toBeNull()
  })

  it("offers the entry for an anonymous session with an open checkout", () => {
    setCtx()
    setBridge()
    const onRequest = vi.fn()
    const item = entry(onRequest)
    expect(item?.label).toBe("Von vorne beginnen")
    item!.onSelect!()
    expect(onRequest).toHaveBeenCalledTimes(1)
  })

  it("is null in kiosk mode (bridge available)", () => {
    setCtx()
    setBridge({ available: true })
    expect(entry()).toBeNull()
  })
})

describe("StartOverConfirm — confirm flow", () => {
  it("confirming 'Verwerfen' calls startOver", () => {
    const startOver = setCtx()
    setBridge()
    render(<Harness />)
    fireEvent.click(button()!)
    fireEvent.click(screen.getByRole("button", { name: "Verwerfen" }))
    expect(startOver).toHaveBeenCalledTimes(1)
  })

  it("'Abbrechen' dismisses without calling startOver", () => {
    const startOver = setCtx()
    setBridge()
    render(<Harness />)
    fireEvent.click(button()!)
    fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }))
    expect(startOver).not.toHaveBeenCalled()
    expect(screen.queryByText("Besuch verwerfen?")).toBeNull()
  })
})

describe("StartOverConfirm — kiosk chrome request (issue #415)", () => {
  it("opens the confirm dialog and acks when the chrome requests start-over", () => {
    setCtx()
    const bridge = setBridge({ available: true })
    render(<Harness />)

    // No dialog yet, and no in-page entry.
    expect(screen.queryByText("Besuch verwerfen?")).toBeNull()
    expect(button()).toBeNull()

    bridge.fireRequest()

    // Dialog now open + chrome acked so it cancels its fallback.
    expect(screen.getByText("Besuch verwerfen?")).toBeTruthy()
    expect(bridge.ackStartOver).toHaveBeenCalledTimes(1)
  })

  it("does not intercept the chrome request when there's nothing to discard", () => {
    setCtx({ openCheckout: null })
    const bridge = setBridge({ available: true })
    render(<Harness />)
    // Subscription is skipped, so the chrome fallback (direct reset) handles it.
    expect(bridge.onStartOverRequest).not.toHaveBeenCalled()
  })
})
