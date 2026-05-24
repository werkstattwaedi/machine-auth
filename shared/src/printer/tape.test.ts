// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest"
import { TAPE_SPECS, TOTAL_PINS } from "./tape"

describe("TAPE_SPECS", () => {
  it.each(Object.entries(TAPE_SPECS))(
    "%s sums to 560 pins (Brother RCR §2.3.5 invariant)",
    (_name, spec) => {
      expect(spec.leftPins + spec.printPins + spec.rightPins).toBe(TOTAL_PINS)
    },
  )
})
