// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Quantity rules shared by the material picker's entry fields (issue #656).
 *
 * Pure: takes the parsed number and returns the German message to show under
 * the field, or `null` when the value is acceptable. Zero, empty and
 * unparseable input share one message; count-type inputs (Stk., Layer)
 * additionally reject fractions. There is deliberately no upper bound —
 * plausibility caps per pricing model were considered and deferred.
 */

export const QUANTITY_POSITIVE_MESSAGE = "Bitte eine Zahl grösser als 0 eingeben"
export const QUANTITY_INTEGER_MESSAGE = "Bitte eine ganze Zahl eingeben"

/** `measure` = dimensional quantity (length, weight, volume, time);
 *  `count` = non-SI integer (Stk., Layer). */
export type QuantityKind = "measure" | "count"

export function quantityError(
  value: number | null | undefined,
  kind: QuantityKind,
): string | null {
  if (value == null || !Number.isFinite(value) || value <= 0) {
    return QUANTITY_POSITIVE_MESSAGE
  }
  if (kind === "count" && !Number.isInteger(value)) {
    return QUANTITY_INTEGER_MESSAGE
  }
  return null
}
