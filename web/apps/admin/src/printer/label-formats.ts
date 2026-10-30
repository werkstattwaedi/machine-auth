// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import type { TapeKey } from "@oww/shared"

export interface LabelFormat {
  /** Shown on the format picker. */
  title: string
  /** Tape the format prints on; the printer refuses the job on any other. */
  tape: TapeKey
  /** Uniform label length in mm (spec "Einheitslänge"). */
  widthMm: number
  /**
   * Vertical calibration: the rendered bitmap is centred in its own pin
   * window, but on the physical tape the content prints biased toward one
   * edge. Positive shifts content toward the higher-pin edge (down). To
   * re-tune: measure the top/bottom margins and adjust by
   * (bottom−top)/2 × 14 dots (360 DPI ⇒ 1 mm ≈ 14 dots).
   */
  verticalOffsetDots: number
  /** Preview height relative to the 18 mm tape, so the on-screen previews
   *  of different formats keep their relative physical size. */
  previewScale: number
}

export const LABEL_FORMATS = {
  // Calibrated against a real 18 mm print: offset 24 measured 2.8 mm top /
  // 1.3 mm bottom, so 13 centres it (~2 mm each side).
  "18x72": {
    title: "18 × 72 mm",
    tape: "18mm",
    widthMm: 72,
    verticalOffsetDots: 13,
    previewScale: 1,
  },
  // Not yet measured on a real 36 mm print: starts from the 18 mm value,
  // assuming the tape's bias on the head doesn't depend on its width.
  "36x100": {
    title: "36 × 100 mm",
    tape: "36mm",
    widthMm: 100,
    verticalOffsetDots: 13,
    previewScale: 2,
  },
} as const satisfies Record<string, LabelFormat>

export type LabelFormatId = keyof typeof LABEL_FORMATS

export const DEFAULT_LABEL_FORMAT: LabelFormatId = "18x72"

export const LABEL_FORMAT_OPTIONS = (
  Object.keys(LABEL_FORMATS) as LabelFormatId[]
).map((value) => ({ value, label: LABEL_FORMATS[value].title }))
