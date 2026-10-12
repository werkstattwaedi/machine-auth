// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest"
import { Timestamp } from "firebase/firestore"
import type { DeviceStatusDoc } from "@modules/lib/firestore-entities"
import { deviceRows, isQuiet, targetRelease } from "./versions"

const t = Timestamp.fromMillis(Date.parse("2026-10-12T08:00:00Z"))

function status(kind: DeviceStatusDoc["kind"], deviceId: string, version: string | null): DeviceStatusDoc {
  return {
    kind,
    deviceId,
    version,
    online: true,
    since: t,
    bootedAt: t,
    resetReason: "power_cycle",
    bootCount: 1,
    firstSeen: t,
    lastSeen: t,
  }
}

describe("targetRelease", () => {
  it("is the newest release the cloud or any device runs", () => {
    expect(targetRelease(["2026.10.3", "dev"], [status("maco", "a", "2026.10.4")])).toBe("2026.10.4")
    expect(targetRelease(["dev"], [])).toBeNull()
  })
})

describe("isQuiet", () => {
  const now = t.toMillis()
  const min = 60_000
  const seen = (ago: number) => Timestamp.fromMillis(now - ago)

  it("flags a device whose hourly refresh is overdue — a dead gateway still says online", () => {
    expect(isQuiet({ kind: "gateways", online: true, lastSeen: seen(70 * min) }, now)).toBe(false)
    expect(isQuiet({ kind: "gateways", online: true, lastSeen: seen(80 * min) }, now)).toBe(true)
  })

  it("gives the once-a-day kiosk a day, and leaves offline devices to their own badge", () => {
    expect(isQuiet({ kind: "kiosks", online: true, lastSeen: seen(20 * 60 * min) }, now)).toBe(false)
    expect(isQuiet({ kind: "maco", online: false, lastSeen: seen(10 * 60 * min) }, now)).toBe(false)
  })
})

describe("deviceRows", () => {
  const names = new Map([["0a10", "Laser"]])

  it("orders gateway, terminals (by name), kiosk and names terminals from maco", () => {
    const rows = deviceRows(
      [
        status("kiosks", "checkout", "2026.10.3"),
        status("maco", "0b20", "2026.10.3"),
        status("maco", "0a10", "2026.10.2"),
        status("gateways", "workshop", "2026.10.3"),
      ],
      names,
      "2026.10.3",
    )
    expect(rows.map((r) => r.name)).toEqual(["workshop", "0b20", "Laser", "checkout"])
    expect(rows.map((r) => r.standing)).toEqual(["current", "current", "behind", "current"])
  })

  it("marks a terminal on old firmware as unknown", () => {
    const [row] = deviceRows([status("maco", "0a10", null)], names, "2026.10.3")
    expect(row.standing).toBe("unknown")
  })
})
