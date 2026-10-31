// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest"
import { buildRasterJob, TAPE_SPECS } from "@oww/shared"
import { LABEL_FORMATS } from "./label-formats"
import { labelWidthDots } from "./render-material-label"

// Offset of the `ESC i z` print-info command in a job: the 200-byte
// invalidate, `ESC @` and `ESC i a n`. The media width is its 6th byte.
const PRINT_INFO_OFFSET = 200 + 2 + 4
const MEDIA_WIDTH_OFFSET = PRINT_INFO_OFFSET + 5

describe.each(Object.entries(LABEL_FORMATS))("label format %s", (_id, format) => {
  it("builds a job asserting the format's tape, so the printer refuses any other", () => {
    const tape = TAPE_SPECS[format.tape]
    const width = labelWidthDots(format.widthMm)
    const bytes = buildRasterJob(
      {
        width,
        height: tape.printPins,
        data: new Uint8Array(width * Math.ceil(tape.printPins / 8)),
      },
      { tape: format.tape, verticalOffsetDots: format.verticalOffsetDots },
    )
    expect(bytes[MEDIA_WIDTH_OFFSET]).toBe(tape.mediaWidth)
  })

  it("keeps its calibration offset on the print head", () => {
    const tape = TAPE_SPECS[format.tape]
    expect(format.verticalOffsetDots).toBeLessThanOrEqual(tape.rightPins)
    expect(format.verticalOffsetDots).toBeGreaterThanOrEqual(-tape.leftPins)
  })
})
