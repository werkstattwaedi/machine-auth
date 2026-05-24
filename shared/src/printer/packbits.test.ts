// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest"
import { packbits, unpackbits } from "./packbits"

describe("packbits", () => {
  it("emits a repeat run for ≥3 identical bytes", () => {
    expect(Array.from(packbits(new Uint8Array([0, 0, 0, 0, 0])))).toEqual([
      // -4 (two's-complement byte 0xFC) means "repeat next byte 5 times".
      0xfc, 0x00,
    ])
  })

  it("emits a literal run for mixed bytes", () => {
    expect(Array.from(packbits(new Uint8Array([1, 2, 3])))).toEqual([
      0x02, 0x01, 0x02, 0x03,
    ])
  })

  it("splits a literal when a triple appears mid-stream", () => {
    // 1, 2, 3, 9, 9, 9 → literal(1,2,3) then repeat(9 × 3)
    expect(Array.from(packbits(new Uint8Array([1, 2, 3, 9, 9, 9])))).toEqual([
      0x02, 0x01, 0x02, 0x03, 0xfe, 0x09,
    ])
  })

  it("round-trips a real-looking 70-byte raster line", () => {
    // A line with two short ink bursts separated by long runs of zeros —
    // typical of a QR-row column on TZe tape.
    const line = new Uint8Array(70)
    line[20] = 0b11010110
    line[21] = 0b10110111
    line[45] = 0b00100100
    const round = unpackbits(packbits(line))
    expect(Array.from(round)).toEqual(Array.from(line))
  })

  it("round-trips runs at the 128-byte chunk boundary", () => {
    const buf = new Uint8Array(300)
    buf.fill(0x42, 0, 150) // long repeat, will be split at 128
    buf.fill(0xff, 150, 160) // short repeat
    for (let i = 160; i < 300; i++) buf[i] = i & 0xff // mostly unique → literals
    expect(Array.from(unpackbits(packbits(buf)))).toEqual(Array.from(buf))
  })

  it("compresses an all-zero 70-byte line to a tiny output", () => {
    // Not the smallest possible representation (Z 0x5A is one byte), but
    // PackBits should still squash it.
    const zeros = new Uint8Array(70)
    const out = packbits(zeros)
    expect(out.length).toBeLessThanOrEqual(2)
    expect(Array.from(unpackbits(out))).toEqual(Array.from(zeros))
  })
})
