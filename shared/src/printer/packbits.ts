// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * TIFF PackBits compressor used by the PT-P950NW raster format (M 02
 * mode). Each output chunk starts with a signed header byte:
 *
 *   [0..127]   → literal run, copy next (n+1) bytes verbatim.
 *   [-1..-127] → repeat run, repeat next byte (1-n) times.
 *   -128       → no-op (we never emit this).
 *
 * The PT-P950NW's `G` raster-line wrapper carries a uint16 length so
 * runs across multiple chunks are fine; we just keep emitting until
 * the input is consumed.
 *
 * Empty input returns an empty buffer; callers should detect all-zero
 * raster lines upstream and emit a `Z` (0x5A) byte instead, which is
 * one byte vs PackBits' minimum two.
 */
export function packbits(input: Uint8Array): Uint8Array {
  // Worst case: alternating bytes that never run → header per byte ⇒
  // 2 × input. Allocate that up front and slice at the end.
  const out = new Uint8Array(input.length * 2)
  let outLen = 0
  let i = 0
  while (i < input.length) {
    // Find a repeat run of ≥3 starting at i (worth emitting as a run).
    let runLen = 1
    while (
      runLen < 128 &&
      i + runLen < input.length &&
      input[i + runLen] === input[i]
    ) {
      runLen++
    }
    if (runLen >= 3) {
      out[outLen++] = 256 - (runLen - 1) // two's-complement of -(runLen-1)
      out[outLen++] = input[i]
      i += runLen
      continue
    }
    // Collect a literal run up to 128 bytes, stopping if we see ≥3 of
    // the same byte (worth breaking out for a repeat run).
    const litStart = i
    while (i < input.length && i - litStart < 128) {
      // Peek for an upcoming triple → end the literal here.
      if (
        i + 2 < input.length &&
        input[i] === input[i + 1] &&
        input[i + 1] === input[i + 2]
      ) {
        break
      }
      i++
    }
    const litLen = i - litStart
    out[outLen++] = litLen - 1
    for (let j = 0; j < litLen; j++) out[outLen++] = input[litStart + j]
  }
  return out.slice(0, outLen)
}

/** Decompressor for tests / round-trip verification. */
export function unpackbits(input: Uint8Array): Uint8Array {
  const out: number[] = []
  let i = 0
  while (i < input.length) {
    const header = input[i++] << 24 >> 24 // sign-extend
    if (header === -128) continue
    if (header >= 0) {
      const n = header + 1
      for (let j = 0; j < n; j++) out.push(input[i++])
    } else {
      const n = 1 - header
      const byte = input[i++]
      for (let j = 0; j < n; j++) out.push(byte)
    }
  }
  return new Uint8Array(out)
}
