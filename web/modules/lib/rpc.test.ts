// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { Functions } from "firebase/functions"

const callableMock = vi.fn()
vi.mock("firebase/functions", () => ({
  httpsCallable: vi.fn(() => callableMock),
}))

import { prewarm, resetPrewarmForTest } from "./rpc"

const functions = {} as Functions

describe("prewarm", () => {
  beforeEach(() => {
    resetPrewarmForTest()
    callableMock.mockReset()
    callableMock.mockResolvedValue({ data: { ok: true } })
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("fires a ping envelope for the group", () => {
    prewarm(functions, "authCall")
    expect(callableMock).toHaveBeenCalledExactlyOnceWith({
      method: "ping",
      payload: {},
    })
  })

  it("dedupes repeated calls within the TTL", () => {
    prewarm(functions, "authCall")
    prewarm(functions, "authCall")
    expect(callableMock).toHaveBeenCalledTimes(1)
  })

  it("tracks groups independently", () => {
    prewarm(functions, "authCall")
    prewarm(functions, "billingCall")
    expect(callableMock).toHaveBeenCalledTimes(2)
  })

  it("pings again once the TTL has elapsed", () => {
    prewarm(functions, "authCall")
    vi.advanceTimersByTime(5 * 60_000)
    prewarm(functions, "authCall")
    expect(callableMock).toHaveBeenCalledTimes(2)
  })

  it("swallows a failed ping and clears the dedupe entry for retry", async () => {
    callableMock.mockRejectedValueOnce(new Error("cold and broken"))
    prewarm(functions, "authCall")
    // Let the rejection propagate through the .catch handler.
    await vi.runAllTimersAsync()
    prewarm(functions, "authCall")
    expect(callableMock).toHaveBeenCalledTimes(2)
  })
})
