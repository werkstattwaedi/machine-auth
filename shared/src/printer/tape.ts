// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * PT-P950NW print-head geometry per Brother "Raster Command Reference
 * v1.02" §2.3.5. The head has 560 pins; for each tape width only the
 * middle window is wired to anything physical, so the raster line has
 * `leftPins` zero bits, then `printPins` bits of data from the bitmap,
 * then `rightPins` zero bits. All three add up to 560.
 *
 * `mediaWidth` is the byte we pass in the `ESC i z` print-info command
 * to assert the loaded cartridge matches what we're rendering for. With
 * `PI_WIDTH` set in the valid-flags byte, the printer refuses the job
 * (and replies with a status frame) when the loaded tape doesn't match
 * — better a clean rejection than a silently wrong print.
 */

export interface TapeSpec {
  leftPins: number
  printPins: number
  rightPins: number
  /** Value for byte [2] of the `ESC i z` payload (media width in mm). */
  mediaWidth: number
}

export const TAPE_SPECS = {
  "3.5mm": { leftPins: 248, printPins: 48, rightPins: 264, mediaWidth: 0x04 },
  "6mm": { leftPins: 240, printPins: 64, rightPins: 256, mediaWidth: 0x06 },
  "9mm": { leftPins: 219, printPins: 106, rightPins: 235, mediaWidth: 0x09 },
  "12mm": { leftPins: 197, printPins: 150, rightPins: 213, mediaWidth: 0x0c },
  "18mm": { leftPins: 155, printPins: 234, rightPins: 171, mediaWidth: 0x12 },
  "24mm": { leftPins: 112, printPins: 320, rightPins: 128, mediaWidth: 0x18 },
  "36mm": { leftPins: 45, printPins: 454, rightPins: 61, mediaWidth: 0x24 },
} as const satisfies Record<string, TapeSpec>

export type TapeKey = keyof typeof TAPE_SPECS

/** Total pin count on the print head. Every tape spec must sum to this. */
export const TOTAL_PINS = 560

/** Raster line width in bytes (560 bits / 8). */
export const RASTER_LINE_BYTES = TOTAL_PINS / 8
