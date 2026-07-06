// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest"
import { Timestamp } from "firebase/firestore"
import { formatDuration } from "./duration"

function ts(ms: number): Timestamp {
  return Timestamp.fromMillis(ms)
}

describe("formatDuration", () => {
  it("formats sub-hour durations as minutes", () => {
    expect(formatDuration(ts(0), ts(45 * 60_000))).toBe("45m")
  })

  it("formats hours with zero-padded minutes", () => {
    expect(formatDuration(ts(0), ts(80 * 60_000))).toBe("1h 20m")
    expect(formatDuration(ts(0), ts(125 * 60_000))).toBe("2h 05m")
  })

  it("rounds to the nearest minute", () => {
    expect(formatDuration(ts(0), ts(90_000))).toBe("2m") // 1.5 min
  })

  it("returns a dash for missing or inverted ranges", () => {
    expect(formatDuration(null, ts(1))).toBe("–")
    expect(formatDuration(ts(1), undefined)).toBe("–")
    expect(formatDuration(ts(60_000), ts(0))).toBe("–")
  })
})
