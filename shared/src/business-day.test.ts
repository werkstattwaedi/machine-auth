// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest"
import {
  businessDayKey,
  isSameBusinessDay,
  BUSINESS_DAY_START_HOUR,
} from "./business-day"

describe("businessDayKey (Europe/Zurich, 03:00 boundary)", () => {
  it("exposes the 03:00 boundary hour", () => {
    expect(BUSINESS_DAY_START_HOUR).toBe(3)
  })

  it("classifies a daytime instant on its own calendar day", () => {
    // 2026-06-06 14:00 Zurich (CEST = UTC+2) -> 12:00 UTC
    const d = new Date("2026-06-06T12:00:00Z")
    expect(businessDayKey(d)).toBe("2026-06-06")
  })

  it("treats 02:00 Zurich as belonging to the previous day", () => {
    // 2026-06-06 02:00 Zurich (CEST = UTC+2) -> 2026-06-06 00:00 UTC
    const d = new Date("2026-06-06T00:00:00Z")
    expect(businessDayKey(d)).toBe("2026-06-05")
  })

  it("treats exactly 03:00 Zurich as the start of the new day", () => {
    // 2026-06-06 03:00 Zurich (CEST = UTC+2) -> 2026-06-06 01:00 UTC
    const d = new Date("2026-06-06T01:00:00Z")
    expect(businessDayKey(d)).toBe("2026-06-06")
  })

  it("treats 02:59 Zurich as still the previous day", () => {
    // 2026-06-06 02:59 Zurich -> 2026-06-06 00:59 UTC
    const d = new Date("2026-06-06T00:59:00Z")
    expect(businessDayKey(d)).toBe("2026-06-05")
  })

  it("handles month/year rollover across the 03:00 boundary", () => {
    // 2027-01-01 02:30 Zurich (CET = UTC+1) -> 2027-01-01 01:30 UTC
    const d = new Date("2027-01-01T01:30:00Z")
    expect(businessDayKey(d)).toBe("2026-12-31")
  })

  it("respects winter-time offset (CET = UTC+1)", () => {
    // 2026-01-15 14:00 Zurich (CET) -> 13:00 UTC
    const d = new Date("2026-01-15T13:00:00Z")
    expect(businessDayKey(d)).toBe("2026-01-15")
  })
})

describe("isSameBusinessDay", () => {
  it("treats two same-day daytime checkouts as the same business day", () => {
    const morning = new Date("2026-06-06T08:00:00Z") // 10:00 Zurich
    const evening = new Date("2026-06-06T18:00:00Z") // 20:00 Zurich
    expect(isSameBusinessDay(morning, evening)).toBe(true)
  })

  it("treats a late-night (02:00) checkout as the same day as the prior afternoon", () => {
    const afternoon = new Date("2026-06-05T15:00:00Z") // 17:00 Zurich 06-05
    const lateNight = new Date("2026-06-06T00:30:00Z") // 02:30 Zurich 06-06 -> belongs to 06-05
    expect(isSameBusinessDay(afternoon, lateNight)).toBe(true)
  })

  it("treats next-day-after-03:00 as a different business day", () => {
    const day1 = new Date("2026-06-05T15:00:00Z") // 17:00 Zurich 06-05
    const day2 = new Date("2026-06-06T05:00:00Z") // 07:00 Zurich 06-06
    expect(isSameBusinessDay(day1, day2)).toBe(false)
  })
})
