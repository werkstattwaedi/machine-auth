// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { Functions } from "firebase/functions"

const callableMock = vi.fn()
vi.mock("firebase/functions", () => ({
  httpsCallable: vi.fn(() => callableMock),
}))

import { httpsCallable } from "firebase/functions"
import { prewarm, reportRpcError, resetPrewarmForTest } from "./rpc"

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

describe("reportRpcError", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    callableMock.mockReset()
    callableMock.mockResolvedValue({ data: { ok: true } })
    // Silence the intentional console.error in reportRpcError.
    consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(() => {
    consoleSpy.mockRestore()
  })

  it("sends the error to logClientError with group.method as path", () => {
    reportRpcError(functions, "checkout.pendingInvitesBanner", "membershipCall", "listMyFamilyInvites", {
      code: "failed-precondition",
      message: "The query requires an index",
    })
    expect(vi.mocked(httpsCallable)).toHaveBeenCalledWith(
      functions,
      "logClientError",
    )
    expect(callableMock).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        context: "checkout.pendingInvitesBanner",
        code: "failed-precondition",
        message: "The query requires an index",
        path: "membershipCall.listMyFamilyInvites",
        sessionId: expect.any(String),
      }),
    )
  })

  it("falls back to name, then 'unknown', for the code", () => {
    reportRpcError(functions, "ctx", "authCall", "resolveTag", new TypeError("boom"))
    expect(callableMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ code: "TypeError", message: "boom" }),
    )
    reportRpcError(functions, "ctx", "authCall", "resolveTag", "plain string")
    expect(callableMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ code: "unknown", message: "plain string" }),
    )
  })

  it("caps the message at 200 chars", () => {
    reportRpcError(functions, "ctx", "billingCall", "acknowledgeBill", {
      message: "x".repeat(500),
    })
    const payload = callableMock.mock.lastCall?.[0] as { message: string }
    expect(payload.message).toHaveLength(200)
  })

  it("never throws — not when the callable rejects, nor when it can't init", async () => {
    callableMock.mockRejectedValueOnce(new Error("telemetry down"))
    expect(() =>
      reportRpcError(functions, "ctx", "authCall", "resolveTag", new Error("e")),
    ).not.toThrow()
    // Let the rejection propagate through the .catch handler.
    await Promise.resolve()

    vi.mocked(httpsCallable).mockImplementationOnce(() => {
      throw new Error("init failure")
    })
    expect(() =>
      reportRpcError(functions, "ctx", "authCall", "resolveTag", new Error("e")),
    ).not.toThrow()
  })
})
