// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest"
import { buildRasterJob } from "./raster"
import { TAPE_SPECS } from "./tape"

function makeBlankBitmap(width: number, height: number) {
  const bytesPerCol = Math.ceil(height / 8)
  return { width, height, data: new Uint8Array(width * bytesPerCol) }
}

describe("buildRasterJob", () => {
  it("emits the expected preamble for an 18 mm blank label", () => {
    const tape = TAPE_SPECS["18mm"]
    const bmp = makeBlankBitmap(4, tape.printPins)
    const job = buildRasterJob(bmp, { tape: "18mm" })

    // 200-byte invalidate prefix.
    for (let i = 0; i < 200; i++) expect(job[i]).toBe(0x00)

    // ESC @
    expect([job[200], job[201]]).toEqual([0x1b, 0x40])
    // ESC i a 01 (switch to raster mode)
    expect([job[202], job[203], job[204], job[205]]).toEqual([
      0x1b, 0x69, 0x61, 0x01,
    ])
    // ESC i z + 10 bytes: flags 0x86, kind 0x01, width 0x12, len 0,
    // raster count 4 (LE32), page 0, 0.
    expect(Array.from(job.subarray(206, 219))).toEqual([
      0x1b, 0x69, 0x7a,
      0x86, 0x01, 0x12, 0x00,
      0x04, 0x00, 0x00, 0x00,
      0x00, 0x00,
    ])
    // ESC i M 0x40 (auto-cut)
    expect(Array.from(job.subarray(219, 223))).toEqual([0x1b, 0x69, 0x4d, 0x40])
    // ESC i A 0x01 (cut every 1 label)
    expect(Array.from(job.subarray(223, 227))).toEqual([0x1b, 0x69, 0x41, 0x01])
    // ESC i K 0x0C (half-cut + no-chain)
    expect(Array.from(job.subarray(227, 231))).toEqual([0x1b, 0x69, 0x4b, 0x0c])
    // ESC i d 14 0 (1 mm margin)
    expect(Array.from(job.subarray(231, 236))).toEqual([
      0x1b, 0x69, 0x64, 0x0e, 0x00,
    ])
    // M 02 (TIFF PackBits)
    expect(Array.from(job.subarray(236, 238))).toEqual([0x4d, 0x02])

    // 4 raster lines, all-zero → 4 × 0x5A (Z byte).
    expect(Array.from(job.subarray(238, 242))).toEqual([0x5a, 0x5a, 0x5a, 0x5a])

    // Final 0x1A print+feed+cut.
    expect(job[job.length - 1]).toBe(0x1a)
  })

  it("places a single-pixel column in the print-area window", () => {
    const tape = TAPE_SPECS["18mm"]
    const bmp = makeBlankBitmap(1, tape.printPins)
    // Set row 0 of column 0 → should land at bit (leftPins = 155) of the
    // raster line.
    bmp.data[0] = 0b10000000
    const job = buildRasterJob(bmp, { tape: "18mm" })

    // Bit 155 across 70 bytes lands at byte 19 (= 155 >> 3), bit 4
    // (= 7 - (155 & 7) = 7 - 3 = 4), value 0x10. The raster line is
    // therefore 19 zero bytes, then 0x10, then 50 zero bytes.
    // PackBits header for "repeat next byte N times" is (1 - N) signed:
    //   N=19 → -18 → 0xEE.   N=50 → -49 → 0xCF.
    // The single 0x10 emits as a 1-byte literal (header 0x00, value 0x10).
    // Total: EE 00 00 10 CF 00 = 6 bytes.
    const g = job.indexOf(0x47, 238)
    expect(g).toBeGreaterThan(0)
    const compLen = job[g + 1] | (job[g + 2] << 8)
    expect(compLen).toBe(6)
    expect(Array.from(job.subarray(g + 3, g + 3 + compLen))).toEqual([
      0xee, 0x00, 0x00, 0x10, 0xcf, 0x00,
    ])
  })

  it("rejects mismatched bitmap height", () => {
    const bmp = makeBlankBitmap(10, 100)
    expect(() => buildRasterJob(bmp, { tape: "18mm" })).toThrow(
      /must equal TAPE_SPECS/,
    )
  })
})
