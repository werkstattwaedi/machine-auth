// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render } from "@testing-library/react"

const mockPrewarm = vi.fn()
vi.mock("@modules/lib/rpc", () => ({
  prewarm: (...args: unknown[]) => mockPrewarm(...args),
}))

const functions = {}
vi.mock("@modules/lib/firebase-context", () => ({
  useFunctions: () => functions,
}))

let bridgeAvailable = true
vi.mock("@modules/lib/use-bridge", () => ({
  useBridge: () => ({ available: bridgeAvailable }),
}))

import { KIOSK_KEEP_WARM_INTERVAL_MS, KioskKeepWarm } from "./kiosk-keep-warm"

describe("KioskKeepWarm", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockPrewarm.mockReset()
    bridgeAvailable = true
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it("warms authCall on mount and on every interval at the kiosk", () => {
    render(<KioskKeepWarm />)
    expect(mockPrewarm).toHaveBeenCalledExactlyOnceWith(functions, "authCall")
    vi.advanceTimersByTime(KIOSK_KEEP_WARM_INTERVAL_MS * 3)
    expect(mockPrewarm).toHaveBeenCalledTimes(4)
  })

  it("stops pinging once unmounted", () => {
    const { unmount } = render(<KioskKeepWarm />)
    unmount()
    vi.advanceTimersByTime(KIOSK_KEEP_WARM_INTERVAL_MS * 3)
    expect(mockPrewarm).toHaveBeenCalledTimes(1)
  })

  it("is inert outside the kiosk", () => {
    bridgeAvailable = false
    render(<KioskKeepWarm />)
    vi.advanceTimersByTime(KIOSK_KEEP_WARM_INTERVAL_MS * 3)
    expect(mockPrewarm).not.toHaveBeenCalled()
  })
})
