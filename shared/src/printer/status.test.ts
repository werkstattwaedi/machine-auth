// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest"
import { parseStatus } from "./status"

function frame(overrides: Partial<Record<number, number>> = {}): Uint8Array {
  const buf = new Uint8Array(32)
  buf[0] = 0x80 // PrintHeadMark
  buf[1] = 0x20 // Size
  buf[2] = 0x42 // 'B' (Brother)
  for (const [k, v] of Object.entries(overrides)) {
    buf[Number(k)] = v
  }
  return buf
}

describe("parseStatus", () => {
  it("returns null for non-32-byte buffers", () => {
    expect(parseStatus(new Uint8Array(16))).toBeNull()
    expect(parseStatus(new Uint8Array(40))).toBeNull()
  })

  it("returns null when the print-head mark is wrong", () => {
    const bad = new Uint8Array(32)
    bad[0] = 0x00
    bad[1] = 0x20
    expect(parseStatus(bad)).toBeNull()
  })

  it("parses a happy 'reply' frame with media info", () => {
    const status = parseStatus(
      frame({
        10: 18, // 18 mm tape loaded
        11: 0x01, // laminated TZe
        18: 0x00, // reply
      }),
    )!
    expect(status.statusType).toBe("reply")
    expect(status.errors).toEqual([])
    expect(status.mediaWidthMm).toBe(18)
    expect(status.mediaType).toBe(0x01)
  })

  it("decodes cover-open + overheating combined errors", () => {
    const status = parseStatus(
      frame({
        9: 0x40 | 0x80, // cover open + overheating
        18: 0x02, // error
      }),
    )!
    expect(status.statusType).toBe("error")
    expect(status.errors).toEqual(["Deckel offen", "Drucker überhitzt"])
  })

  it("flags wrong-tape errors via error-info byte 1 bit 0x40", () => {
    const status = parseStatus(
      frame({
        8: 0x40,
        18: 0x02,
      }),
    )!
    expect(status.errors).toContain("Falsches Band für gewählte Vorlage")
  })

  it("flags no-media when bit 0x01 set", () => {
    const status = parseStatus(
      frame({
        8: 0x01,
        18: 0x02,
      }),
    )!
    expect(status.errors).toContain("Kein Band eingelegt")
  })

  it("reports printing-complete as a success status type", () => {
    const status = parseStatus(frame({ 18: 0x01 }))!
    expect(status.statusType).toBe("printing-complete")
    expect(status.errors).toEqual([])
  })
})
