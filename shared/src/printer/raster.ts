// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { packbits } from "./packbits"
import {
  RASTER_LINE_BYTES,
  TAPE_SPECS,
  type TapeKey,
  type TapeSpec,
} from "./tape"

/**
 * Column-major 1-bit-per-pixel bitmap. One byte holds 8 vertical
 * pixels MSB-first (row 0 in bit 7, row 7 in bit 0). Columns are laid
 * out left-to-right in `data`. This orientation matches how the
 * PT-P950NW consumes raster lines: one column of pixels = one raster
 * line = one trip of the print head across the tape.
 *
 *   data.length === width × ceil(height / 8)
 *
 * `height` must equal the tape's `printPins` value (e.g. 234 for
 * 18 mm tape); `width` is the label length in dots at 360 DPI.
 */
export interface Bitmap1 {
  width: number
  height: number
  data: Uint8Array
}

export interface RasterJobOptions {
  tape: TapeKey
  /** Auto-cut at the end of the job. Defaults to true. */
  autoCut?: boolean
  /** Half-cut at chain boundaries (single-label jobs ignore this).
   *  Defaults to true. */
  halfCut?: boolean
  /** Tape feed margin in dots. 360 DPI ⇒ 1 mm ≈ 14 dots; the spec's
   *  minimum is 14, max 1800. Defaults to 14 (1 mm). */
  marginDots?: number
  /** Vertical calibration offset across the tape width, in dots (360 DPI
   *  ⇒ 1 mm ≈ 14 dots). Shifts the printable band within the print head:
   *  positive moves the content toward the higher-pin edge, negative
   *  toward the lower-pin edge. The bitmap is always centred in its own
   *  `printPins` window; this compensates for the physical tape not
   *  sitting exactly where the head geometry assumes, which shows up as
   *  content biased to one edge of the printed tape. Clamped to
   *  `[-leftPins, rightPins]` so the band never falls off the head.
   *  Defaults to 0 (Brother's nominal geometry). */
  verticalOffsetDots?: number
}

// Raster Command Reference v1.02, §4.
const ESC = 0x1b
const INVALIDATE_LEN = 200

/** Build a complete PT-P950NW raster print job from a 1-bit bitmap.
 *  The output is one TCP write away from a printed label. */
export function buildRasterJob(
  bitmap: Bitmap1,
  opts: RasterJobOptions,
): Uint8Array {
  const tape = TAPE_SPECS[opts.tape]
  const autoCut = opts.autoCut ?? true
  const halfCut = opts.halfCut ?? true
  const marginDots = opts.marginDots ?? 14
  // Clamp the calibration offset so the printable band always stays on
  // the head (never off either edge).
  const verticalOffset = Math.max(
    -tape.leftPins,
    Math.min(tape.rightPins, Math.round(opts.verticalOffsetDots ?? 0)),
  )

  if (bitmap.height !== tape.printPins) {
    throw new Error(
      `bitmap.height ${bitmap.height} must equal TAPE_SPECS["${opts.tape}"].printPins (${tape.printPins})`,
    )
  }
  const bytesPerCol = Math.ceil(bitmap.height / 8)
  if (bitmap.data.length !== bitmap.width * bytesPerCol) {
    throw new Error(
      `bitmap.data length ${bitmap.data.length} doesn't match width(${bitmap.width}) × bytesPerCol(${bytesPerCol})`,
    )
  }

  const chunks: Uint8Array[] = []
  const push = (...bytes: number[]) => chunks.push(new Uint8Array(bytes))

  // §2.1 (1) Initialization commands — once per job.
  chunks.push(new Uint8Array(INVALIDATE_LEN)) // all zeros
  push(ESC, 0x40) // ESC @  initialize

  // §4 ESC i a — switch to raster mode. Even if the printer is in
  // P-touch Template mode from a prior session, this puts it back.
  push(ESC, 0x69, 0x61, 0x01)

  // §4 ESC i z — print information.
  //   [0] valid-flags: 0x86 = PI_RECOVER | PI_WIDTH | PI_KIND.
  //   [1] media kind:  0x01 laminated TZe.
  //   [2] width mm:    tape.mediaWidth.
  //   [3] length mm:   0 (continuous tape).
  //   [4..7] raster line count, LE32.
  //   [8] starting page: 0.
  //   [9] 0.
  const lines = bitmap.width
  push(
    ESC, 0x69, 0x7a,
    0x86,
    0x01,
    tape.mediaWidth,
    0x00,
    lines & 0xff,
    (lines >> 8) & 0xff,
    (lines >> 16) & 0xff,
    (lines >> 24) & 0xff,
    0x00,
    0x00,
  )

  // §4 ESC i M — various mode. Bit 6 = auto-cut.
  push(ESC, 0x69, 0x4d, autoCut ? 0x40 : 0x00)
  // ESC i A — cut every N labels. Single-label jobs use 1.
  push(ESC, 0x69, 0x41, 0x01)
  // §4 ESC i K — advanced mode. Bit 2 = half-cut, bit 3 = no-chain.
  push(ESC, 0x69, 0x4b, (halfCut ? 0x04 : 0x00) | 0x08)
  // §4 ESC i d — margin (feed amount) in dots, LE16.
  push(ESC, 0x69, 0x64, marginDots & 0xff, (marginDots >> 8) & 0xff)
  // §4 M — select compression. 0x02 = TIFF PackBits.
  push(0x4d, 0x02)

  // §2.1 (3) Raster data — one line per label-X column.
  const reusableLine = new Uint8Array(RASTER_LINE_BYTES)
  for (let col = 0; col < bitmap.width; col++) {
    fillRasterLine(reusableLine, bitmap, col, tape, bytesPerCol, verticalOffset)
    if (isZero(reusableLine)) {
      push(0x5a) // Z — empty raster, one byte instead of compressed run.
      continue
    }
    const compressed = packbits(reusableLine)
    const header = new Uint8Array(3 + compressed.length)
    header[0] = 0x47 // G
    header[1] = compressed.length & 0xff
    header[2] = (compressed.length >> 8) & 0xff
    header.set(compressed, 3)
    chunks.push(header)
  }

  // §2.1 (4) Print + feed + cut. 0x1A on the last (and only) page.
  push(0x1a)

  return concat(chunks)
}

/** Pack column `col` of `bitmap` into a 70-byte raster line, with the
 *  bitmap's bits placed in the tape's print-area pin window and zero
 *  bits elsewhere. */
function fillRasterLine(
  out: Uint8Array,
  bitmap: Bitmap1,
  col: number,
  tape: TapeSpec,
  bytesPerCol: number,
  verticalOffset: number,
): void {
  out.fill(0)
  const colStart = col * bytesPerCol
  const startBit = tape.leftPins + verticalOffset
  for (let row = 0; row < bitmap.height; row++) {
    const srcByte = bitmap.data[colStart + (row >> 3)]
    const srcBit = (srcByte >> (7 - (row & 7))) & 1
    if (srcBit) {
      const destBit = startBit + row
      out[destBit >> 3] |= 1 << (7 - (destBit & 7))
    }
  }
}

function isZero(buf: Uint8Array): boolean {
  for (let i = 0; i < buf.length; i++) if (buf[i] !== 0) return false
  return true
}

function concat(parts: Uint8Array[]): Uint8Array {
  let total = 0
  for (const p of parts) total += p.length
  const out = new Uint8Array(total)
  let off = 0
  for (const p of parts) {
    out.set(p, off)
    off += p.length
  }
  return out
}
