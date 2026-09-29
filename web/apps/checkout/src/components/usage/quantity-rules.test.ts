// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest"
import {
  QUANTITY_INTEGER_MESSAGE,
  QUANTITY_POSITIVE_MESSAGE,
  quantityError,
  type QuantityKind,
} from "./quantity-rules"

describe("quantityError", () => {
  it.each<[number | null | undefined, QuantityKind]>([
    [0, "measure"],
    [0, "count"],
    [-1, "measure"],
    [null, "measure"],
    [null, "count"],
    [undefined, "count"],
    [Number.NaN, "measure"],
    [Number.POSITIVE_INFINITY, "count"],
  ])("%s (%s) → positive-number message", (value, kind) => {
    expect(quantityError(value, kind)).toBe(QUANTITY_POSITIVE_MESSAGE)
  })

  it.each([1.5, 0.5, 12.5, 1000.001])(
    "fractional count %s → integer message",
    (value) => {
      expect(quantityError(value, "count")).toBe(QUANTITY_INTEGER_MESSAGE)
    },
  )

  it.each([1, 3, 1000, 999999])("integer count %s is accepted", (value) => {
    expect(quantityError(value, "count")).toBeNull()
  })

  it.each([0.001, 1.5, 99.9999, 999999])(
    "measure %s is accepted (no upper bound, fractions allowed)",
    (value) => {
      expect(quantityError(value, "measure")).toBeNull()
    },
  )
})
