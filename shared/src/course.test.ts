// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest"
import {
  attendanceCount,
  attendanceSummary,
  closePreset,
  courseWindows,
  coursePhase,
  dateHasStarted,
  defaultCloseReason,
  type AttendanceStatus,
} from "./course"

const st = (status: number, pct: number): [number, AttendanceStatus] => [
  status,
  { status, name: `s${status}`, symbol: "x", color: "#000000", attendancePct: pct },
]
const STATUSES = new Map([st(0, 0), st(1, 100), st(2, 90), st(3, 0), st(4, 0)])
const d1 = { dateId: "d1", start: "2026-10-31T09:00:00+01:00", end: "2026-10-31T12:00:00+01:00" }
const d2 = { dateId: "d2", start: "2026-11-07T09:00:00+01:00", end: "2026-11-07T12:00:00+01:00" }
const link = { userId: "u", choice: "temp" as const, hasBadge: true, alreadyHeld: false }

describe("attendanceCount", () => {
  it("counts by edoobox's Anwesenheit", () => {
    expect(attendanceCount(1, STATUSES)).toBe("attended")
    expect(attendanceCount(2, STATUSES)).toBe("attended")
    expect(attendanceCount(3, STATUSES)).toBe("missed")
    expect(attendanceCount(0, STATUSES)).toBe("none")
    expect(attendanceCount(undefined, STATUSES)).toBe("none")
    expect(attendanceCount(9, STATUSES)).toBe("missed")
  })
})

describe("coursePhase", () => {
  it("is upcoming, running, then to close from the last Termin's start", () => {
    expect(coursePhase([d1, d2], Date.parse("2026-10-30T12:00:00Z"))).toBe("upcoming")
    expect(coursePhase([d1, d2], Date.parse("2026-11-01T12:00:00Z"))).toBe("running")
    expect(coursePhase([d1, d2], Date.parse(d2.start))).toBe("toClose")
    expect(coursePhase([], 0)).toBe("upcoming")
  })
  it("knows when a Termin has started", () => {
    expect(dateHasStarted(d1, Date.parse(d1.start) - 1)).toBe(false)
    expect(dateHasStarted(d1, Date.parse(d1.start))).toBe(true)
  })
})

describe("courseWindows", () => {
  it("runs from each start until 1 h after its end", () => {
    expect(courseWindows([d2, d1])).toEqual([
      { fromMs: Date.parse(d1.start), untilMs: Date.parse(d1.end) + 3600_000 },
      { fromMs: Date.parse(d2.start), untilMs: Date.parse(d2.end) + 3600_000 },
    ])
  })
})

describe("close presets and reasons (CRS-12, CRS-13)", () => {
  it("presets Ja for Vorläufig, Ja and already held; Nein otherwise", () => {
    expect(closePreset({ link })).toBe(true)
    expect(closePreset({ link: { ...link, choice: "yes" } })).toBe(true)
    expect(closePreset({ link: { ...link, choice: "no" } })).toBe(false)
    expect(closePreset({ link: { ...link, choice: "no", alreadyHeld: true } })).toBe(true)
    expect(closePreset({ link: null })).toBe(false)
  })
  it("prefills the reason by the first case that applies", () => {
    const dates = [d1, d2]
    expect(defaultCloseReason({ link: null, attendance: { d1: 1, d2: 1 } }, dates, STATUSES)).toBe("Kein Konto")
    expect(defaultCloseReason({ link, attendance: {} }, dates, STATUSES)).toBe("Nicht teilgenommen")
    expect(defaultCloseReason({ link, attendance: { d1: 3, d2: 4 } }, dates, STATUSES)).toBe("Nicht teilgenommen")
    expect(defaultCloseReason({ link, attendance: { d1: 2, d2: 4 } }, dates, STATUSES)).toBe(
      "Nicht an allen Terminen teilgenommen",
    )
    expect(defaultCloseReason({ link, attendance: { d1: 1, d2: 2 } }, dates, STATUSES)).toBe("")
  })
  it("summarises attended and missed Termine", () => {
    expect(attendanceSummary({ attendance: { d1: 1, d2: 3 } }, [d1, d2], STATUSES)).toEqual({ attended: 1, missed: 1 })
  })
})
