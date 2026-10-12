// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest"
import { kioskStatusDue } from "./kiosk-status-reporter"

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.parse("2026-10-12T08:00:00Z")

describe("kioskStatusDue", () => {
  it("reports a kiosk that never reported", () => {
    expect(kioskStatusDue(null, "2026.10.3", NOW)).toBe(true)
  })

  it("reports a new version at once", () => {
    expect(kioskStatusDue({ version: "2026.10.2", at: NOW - 1000 }, "2026.10.3", NOW)).toBe(true)
  })

  it("stays quiet within the day, then reports again", () => {
    const reported = { version: "2026.10.3", at: NOW }
    expect(kioskStatusDue(reported, "2026.10.3", NOW + DAY - 1)).toBe(false)
    expect(kioskStatusDue(reported, "2026.10.3", NOW + DAY)).toBe(true)
  })
})
