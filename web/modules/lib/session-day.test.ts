// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Boundary tests for the 3:00 AM Europe/Zurich session-day rollover.
 * Mirrors the server-side semantics in
 * `functions/src/util/session_expiration.ts` (3am cutoff, late-night
 * sessions stay on the same day).
 */

import { describe, it, expect, vi } from "vitest"
import { sessionDayKey, isCheckoutStale } from "./session-day"

// All inputs below are UTC; the function projects them into Europe/Zurich.
// May → CEST (UTC+2). Examples chosen so the local-time intent is obvious.

const utc = (s: string) => new Date(s + "Z")

describe("sessionDayKey (Europe/Zurich, 3am rollover)", () => {
  it("returns YYYY-MM-DD for an afternoon moment", () => {
    // 2026-05-15 14:00 Zurich (= 12:00 UTC, CEST = UTC+2)
    expect(sessionDayKey(utc("2026-05-15T12:00:00"))).toBe("2026-05-15")
  })

  it("rolls back to the previous calendar day before 3 AM local", () => {
    // 2026-05-16 02:30 Zurich (= 00:30 UTC) — still belongs to 2026-05-15.
    expect(sessionDayKey(utc("2026-05-16T00:30:00"))).toBe("2026-05-15")
  })

  it("flips to a new session day at exactly 3 AM local", () => {
    // 2026-05-16 03:00 Zurich (= 01:00 UTC) — new day starts here.
    expect(sessionDayKey(utc("2026-05-16T01:00:00"))).toBe("2026-05-16")
  })

  it("crosses month boundary when rolling back", () => {
    // 2026-06-01 01:00 Zurich — still belongs to 2026-05-31.
    expect(sessionDayKey(utc("2026-05-31T23:00:00"))).toBe("2026-05-31")
  })

  it("crosses year boundary when rolling back", () => {
    // 2027-01-01 02:00 Zurich (= 2027-01-01T01:00Z in CET = UTC+1) — still 2026-12-31.
    expect(sessionDayKey(utc("2027-01-01T01:00:00"))).toBe("2026-12-31")
  })

  it("handles winter (CET = UTC+1) correctly", () => {
    // 2026-01-15 14:00 Zurich (= 13:00 UTC)
    expect(sessionDayKey(utc("2026-01-15T13:00:00"))).toBe("2026-01-15")
    // 2026-01-16 02:30 Zurich (= 01:30 UTC) — still 2026-01-15.
    expect(sessionDayKey(utc("2026-01-16T01:30:00"))).toBe("2026-01-15")
  })
})

describe("isCheckoutStale", () => {
  it("returns false for a checkout from the same session day", () => {
    // Both moments fall on 2026-05-15 (afternoon then late evening).
    const created = utc("2026-05-15T12:00:00")
    const now = utc("2026-05-15T22:00:00")
    expect(isCheckoutStale(created, now)).toBe(false)
  })

  it("returns false for a late-night visit that crosses midnight", () => {
    // Created at 23:00 Zurich on 2026-05-15, checked at 02:00 Zurich on
    // 2026-05-16 — both still belong to session day 2026-05-15.
    const created = utc("2026-05-15T21:00:00") // 23:00 Zurich
    const now = utc("2026-05-16T00:00:00") // 02:00 Zurich
    expect(isCheckoutStale(created, now)).toBe(false)
  })

  it("returns true once the 3 AM rollover has happened", () => {
    // Created at 22:00 Zurich on 2026-05-15, checked at 04:00 Zurich on
    // 2026-05-16 — past the rollover, stale.
    const created = utc("2026-05-15T20:00:00") // 22:00 Zurich
    const now = utc("2026-05-16T02:00:00") // 04:00 Zurich
    expect(isCheckoutStale(created, now)).toBe(true)
  })

  it("considers a checkout from a week ago stale", () => {
    const created = utc("2026-05-08T12:00:00")
    const now = utc("2026-05-15T12:00:00")
    expect(isCheckoutStale(created, now)).toBe(true)
  })

  it("uses the current time when `now` is omitted", () => {
    // Pin the wall clock: with a real clock this ran red in the
    // 02:00–03:00 Europe/Zurich window, where `now + 1h` crosses the
    // 03:00 rollover and lands on the next session day.
    vi.useFakeTimers()
    try {
      vi.setSystemTime(utc("2026-05-15T12:00:00"))
      // Created an hour from now → not stale (smoke test of the default).
      const created = new Date(Date.now() + 60 * 60 * 1000)
      expect(isCheckoutStale(created)).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
