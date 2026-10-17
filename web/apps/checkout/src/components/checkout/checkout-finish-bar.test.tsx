// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/** The bottom bar after the commit, per device (issue #750). */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react"
import { CheckoutFinishBar, KIOSK_FINISH_MS } from "./checkout-finish-bar"

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe("CheckoutFinishBar", () => {
  it("kiosk: Fertig resets the terminal by itself after 8 s", () => {
    const onFinish = vi.fn()
    render(<CheckoutFinishBar kiosk signedIn={false} holdCountdown={false} onFinish={onFinish} />)

    act(() => {
      vi.advanceTimersByTime(KIOSK_FINISH_MS - 100)
    })
    expect(onFinish).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(onFinish).toHaveBeenCalledOnce()
  })

  it("kiosk: an open QR slip stops the countdown; Fertig waits for a tap", () => {
    const onFinish = vi.fn()
    render(<CheckoutFinishBar kiosk signedIn={false} holdCountdown onFinish={onFinish} />)

    act(() => {
      vi.advanceTimersByTime(KIOSK_FINISH_MS * 3)
    })
    expect(onFinish).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Fertig" }))
    expect(onFinish).toHaveBeenCalledOnce()
  })

  it("own device, signed in: Fertig without a countdown", () => {
    const onFinish = vi.fn()
    render(<CheckoutFinishBar kiosk={false} signedIn holdCountdown={false} onFinish={onFinish} />)

    act(() => {
      vi.advanceTimersByTime(KIOSK_FINISH_MS * 3)
    })
    expect(onFinish).not.toHaveBeenCalled()
    expect(screen.queryByTestId("auto-action-progress")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Fertig" }))
    expect(onFinish).toHaveBeenCalledOnce()
  })

  it("own device without an account: no button, only the closing line", () => {
    render(
      <CheckoutFinishBar kiosk={false} signedIn={false} holdCountdown={false} onFinish={() => {}} />,
    )
    expect(screen.queryByRole("button")).toBeNull()
    expect(screen.getByText("Du kannst dieses Fenster jetzt schliessen.")).toBeTruthy()
  })
})
