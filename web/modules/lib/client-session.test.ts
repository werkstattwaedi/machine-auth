// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeEach } from "vitest"

describe("getClientSessionId", () => {
  beforeEach(() => {
    sessionStorage.clear()
    // Reset module state so the in-memory fallback and any cached import state
    // don't leak between tests.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).__owwClientSessionReset?.()
  })

  it("generates and persists an 8-char base36 ID on first call", async () => {
    const { getClientSessionId } = await import("./client-session")
    const id = getClientSessionId()
    expect(id).toMatch(/^[0-9a-z]{8}$/)
    expect(sessionStorage.getItem("oww.sessionId")).toBe(id)
  })

  it("returns the same ID on subsequent calls", async () => {
    const { getClientSessionId } = await import("./client-session")
    const first = getClientSessionId()
    const second = getClientSessionId()
    expect(second).toBe(first)
  })

  it("generates a fresh ID after sessionStorage.clear()", async () => {
    const { getClientSessionId } = await import("./client-session")
    const first = getClientSessionId()
    sessionStorage.clear()
    const second = getClientSessionId()
    expect(second).toMatch(/^[0-9a-z]{8}$/)
    expect(second).not.toBe(first)
    expect(sessionStorage.getItem("oww.sessionId")).toBe(second)
  })
})
