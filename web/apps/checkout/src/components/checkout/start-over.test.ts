// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * runStartOver — the shared reset primitive (issue #415). Both the in-page
 * "Von vorne beginnen" and the kiosk chrome "Neuer Checkout" route through it,
 * so it must give the same strong wipe: in the kiosk, clear the volatile
 * Electron partition via bridge.resetSession() BEFORE the reload.
 */

import { afterEach, describe, expect, it, vi } from "vitest"
import { runStartOver } from "./start-over"

afterEach(() => {
  vi.restoreAllMocks()
})

function makeDeps(over: Record<string, unknown> = {}) {
  return {
    signOut: vi.fn(async () => {}),
    bridgeAvailable: false,
    resetSession: vi.fn(async () => {}),
    reload: vi.fn(),
    kiosk: false,
    ...over,
  }
}

describe("runStartOver", () => {
  it("signs out and hard-reloads to /checkin in a browser tab", async () => {
    const deps = makeDeps()
    await runStartOver(deps)
    expect(deps.signOut).toHaveBeenCalledTimes(1)
    expect(deps.resetSession).not.toHaveBeenCalled()
    expect(deps.reload).toHaveBeenCalledWith("/checkin")
  })

  it("wipes the kiosk partition via resetSession BEFORE reload", async () => {
    const order: string[] = []
    const deps = makeDeps({
      bridgeAvailable: true,
      kiosk: true,
      resetSession: vi.fn(async () => {
        order.push("reset")
      }),
      reload: vi.fn(() => {
        order.push("reload")
      }),
    })
    await runStartOver(deps)
    expect(deps.resetSession).toHaveBeenCalledTimes(1)
    expect(order).toEqual(["reset", "reload"])
    expect(deps.reload).toHaveBeenCalledWith("/checkin?kiosk")
  })

  it("still reloads when resetSession rejects (tolerant wipe)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const deps = makeDeps({
      bridgeAvailable: true,
      resetSession: vi.fn(async () => {
        throw new Error("boom")
      }),
    })
    await runStartOver(deps)
    expect(deps.reload).toHaveBeenCalledWith("/checkin")
  })

  it("still reloads when signOut rejects", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const deps = makeDeps({
      signOut: vi.fn(async () => {
        throw new Error("nope")
      }),
    })
    await runStartOver(deps)
    expect(deps.reload).toHaveBeenCalledWith("/checkin")
  })
})
