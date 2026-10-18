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
import {
  APPROVAL_REPORT_FLUSH_MS,
  trackTerminalReport,
} from "./pending-terminal-report"

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
  it("lets a terminal approval report finish before the wipe (#812)", async () => {
    const order: string[] = []
    let finishReport: () => void = () => {}
    trackTerminalReport(
      new Promise<void>((resolve) => {
        finishReport = () => {
          order.push("report")
          resolve()
        }
      }),
    )
    const deps = makeDeps({ signOut: vi.fn(async () => void order.push("signOut")) })
    const done = runStartOver(deps)
    await Promise.resolve()
    expect(order).toEqual([])
    finishReport()
    await done
    expect(order).toEqual(["report", "signOut"])
  })

  it("wipes anyway when the report hangs", async () => {
    vi.useFakeTimers()
    try {
      trackTerminalReport(new Promise<void>(() => {}))
      const deps = makeDeps()
      const done = runStartOver(deps)
      await vi.advanceTimersByTimeAsync(APPROVAL_REPORT_FLUSH_MS)
      await done
      expect(deps.reload).toHaveBeenCalledWith("/checkin")
    } finally {
      vi.useRealTimers()
    }
  })

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

  // Issue #732: the start-screen toast's first name survives the wipe only
  // in the URL.
  it("carries the started hint into the kiosk reload target", async () => {
    const deps = makeDeps({ bridgeAvailable: true, kiosk: true })
    await runStartOver({ ...deps, startedHint: "Zoë Müller" })
    expect(deps.reload).toHaveBeenCalledWith(
      "/checkin?kiosk&started=Zo%C3%AB%20M%C3%BCller",
    )
  })

  it("omits the hint param when there is no name", async () => {
    const deps = makeDeps({ kiosk: true })
    await runStartOver({ ...deps, startedHint: null })
    expect(deps.reload).toHaveBeenCalledWith("/checkin?kiosk")
  })
})
