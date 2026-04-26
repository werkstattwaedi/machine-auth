// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Unit conversion + smart display formatting.
 *
 * ## Storage convention (single source of truth)
 *
 * Every quantity stored in Firestore lives in its dimension's SI base unit:
 *
 * | Pricing model | Dimension | Stored unit | Notes                         |
 * |---------------|-----------|-------------|-------------------------------|
 * | `length`      | length    | meter (`m`) | even if input is cm           |
 * | `area`        | area      | m²          | even if input is cm × cm      |
 * | `volume`      | volume    | liter (`l`) | (no current pricing model)    |
 * | `weight`      | mass      | kg          | even if input is g            |
 * | `time`        | time      | hour (`h`)  | even if NFC reports seconds   |
 * | `count`       | count     | raw integer | non-SI                        |
 * | `direct`      | currency  | CHF         | non-SI                        |
 * | `sla` (resin) | volume    | liter (`l`) | (also tracks integer layers)  |
 *
 * `unitPrice` on a catalog item is therefore in CHF per the row's stored unit
 * (e.g. CHF/m² for area, CHF/l for SLA resin). Display layers should never
 * persist a rescaled value back to Firestore — they only call
 * {@link formatQuantity} or {@link formatUnitPrice} on read.
 *
 * ## Display behaviour
 *
 * - {@link formatQuantity} delegates to `convert(value, baseUnit).to("best",
 *   "metric")` so 0.00009 l renders as "0.09 mL", 1500 m as "1.5 km", etc.
 *   The displayed numeric portion uses `Intl.NumberFormat` with the locale
 *   from `VITE_LOCALE` (default `de-CH`) so decimals follow the same
 *   convention as {@link formatCHF}. Unit suffixes are normalised to the
 *   workshop-friendly forms used elsewhere in the UI (`m²`, `ml`, `min`).
 * - {@link formatUnitPrice} formats CHF per smart-rescaled unit, e.g.
 *   `formatUnitPrice(0.09, "l")` → "CHF 0.0001/mL". This unblocks the SLA
 *   price display in #140 without bolting a per-item `priceDisplay.multiplier`
 *   field onto Firestore.
 * - {@link formatCount} handles the non-SI counts (Stk., Layer, Cuts) with a
 *   simple thousands-separator formatter.
 *
 * ## Parsing
 *
 * {@link parseQuantity} accepts user input like "100 ml", "5.5 km", or
 * "1,5 kg" (German decimal comma) and returns the value in the requested
 * base unit, or `null` if the string can't be parsed. It exists for future
 * admin/catalog-editing flows; checkout rows still hold form input in the
 * raw user-friendly unit (cm, g, ml) for backwards compatibility with stored
 * `formInputs`.
 */

import { convert } from "convert"
import type { Unit } from "convert"

/** SI base unit for each {@link PricingModel} that has a dimension. */
export type BaseUnit = "m" | "m2" | "l" | "kg" | "h"

/** All units recognised by `parseQuantity` for each base dimension. */
const PARSE_ALIASES: Record<BaseUnit, Record<string, Unit>> = {
  m: {
    mm: "mm",
    cm: "cm",
    dm: "dm",
    m: "m",
    km: "km",
  },
  m2: {
    "mm²": "mm2",
    "mm2": "mm2",
    "cm²": "cm2",
    "cm2": "cm2",
    "dm²": "dm2",
    "dm2": "dm2",
    "m²": "m2",
    "m2": "m2",
    "km²": "km2",
    "km2": "km2",
  },
  l: {
    "µl": "µl",
    "ul": "µl",
    "ml": "ml",
    "cl": "cl",
    "dl": "dl",
    "l": "l",
  },
  kg: {
    "µg": "µg",
    "ug": "µg",
    "mg": "mg",
    "g": "g",
    "kg": "kg",
    "t": "tonne",
  },
  h: {
    ms: "ms",
    s: "s",
    sec: "s",
    min: "min",
    h: "hour",
    hr: "hour",
    std: "hour",
    "std.": "hour",
  },
}

/** Canonicalise the unit string `convert.to("best")` returns. */
function prettyUnit(unit: string): string {
  // convert returns area units as "cm2", "m2", etc. — render with superscript.
  if (/^(\w+?)2$/.test(unit)) return unit.replace(/2$/, "²")
  // convert spells volume as "mL"/"L"; UI uses lowercase.
  if (unit === "mL") return "ml"
  if (unit === "cL") return "cl"
  if (unit === "dL") return "dl"
  if (unit === "L") return "l"
  if (unit === "uL") return "µl"
  // mass micrograms
  if (unit === "ug") return "µg"
  if (unit === "tonne") return "t"
  // time
  if (unit === "hour") return "h"
  return unit
}

/** Map of our `BaseUnit` to the literal string the `convert` lib expects. */
const CONVERT_BASE: Record<BaseUnit, Unit> = {
  m: "m",
  m2: "m2",
  l: "l",
  kg: "kg",
  h: "h",
}

const locale = import.meta.env?.VITE_LOCALE ?? "de-CH"
const currency = import.meta.env?.VITE_CURRENCY ?? "CHF"

const unitNumberFormatter = new Intl.NumberFormat(locale, {
  minimumFractionDigits: 0,
  maximumFractionDigits: 3,
})

const priceNumberFormatter = new Intl.NumberFormat(locale, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
})

export interface FormatQuantityOptions {
  /** Override the locale's max fractional digits for the rescaled value. */
  maximumFractionDigits?: number
  /** Override the locale's min fractional digits for the rescaled value. */
  minimumFractionDigits?: number
}

/**
 * Render a stored base-unit value at the most human-friendly SI prefix.
 *
 * Examples (locale = `de-CH`):
 * - `formatQuantity(0.00009, "l")` → "0.09 ml"
 * - `formatQuantity(1500, "m")`    → "1.5 km"
 * - `formatQuantity(0.5, "kg")`    → "500 g"
 * - `formatQuantity(0.25, "h")`    → "15 min"
 */
export function formatQuantity(
  value: number,
  baseUnit: BaseUnit,
  opts: FormatQuantityOptions = {},
): string {
  if (!Number.isFinite(value)) return ""
  const best = convert(value, CONVERT_BASE[baseUnit]).to("best", "metric")
  const fmt =
    opts.maximumFractionDigits != null || opts.minimumFractionDigits != null
      ? new Intl.NumberFormat(locale, {
          minimumFractionDigits: opts.minimumFractionDigits ?? 0,
          maximumFractionDigits: opts.maximumFractionDigits ?? 3,
        })
      : unitNumberFormatter
  return `${fmt.format(best.quantity)} ${prettyUnit(best.unit)}`
}

export interface FormatUnitPriceOptions {
  /**
   * Reference quantity (in the base unit) used to pick the display unit for
   * the denominator. The function will rescale this quantity using
   * {@link formatQuantity}'s logic and divide the price accordingly. Defaults
   * to 1 base unit, which keeps the display in CHF/<base unit> for normal
   * prices. Pass a small number (e.g. 0.05 l for SLA resin print volume) to
   * rescale into a smaller unit.
   */
  referenceQuantity?: number
}

/**
 * Render a CHF-per-unit price. By default the denominator stays in the base
 * unit (e.g. CHF/m²). Pass `referenceQuantity` to rescale into the smart unit
 * for that magnitude — useful for SLA resin where a typical print is ~50 ml
 * and CHF/ml reads more naturally than CHF/l.
 *
 * Examples:
 * - `formatUnitPrice(15, "m2")` → "CHF 15.00/m²"
 * - `formatUnitPrice(90, "l")`  → "CHF 90.00/l"
 * - `formatUnitPrice(90, "l", { referenceQuantity: 0.05 })` → "CHF 0.09/ml"
 */
export function formatUnitPrice(
  pricePerBaseUnit: number,
  baseUnit: BaseUnit,
  opts: FormatUnitPriceOptions = {},
): string {
  if (!Number.isFinite(pricePerBaseUnit)) return ""
  const refQty = opts.referenceQuantity ?? 1
  if (refQty <= 0) {
    // Degenerate; fall back to base unit so we always render something.
    return `${currency} ${priceNumberFormatter.format(pricePerBaseUnit)}/${prettyUnit(CONVERT_BASE[baseUnit])}`
  }
  // ref.quantity is "how many of the rescaled unit make up `refQty` base
  // units" (e.g. 0.05 L → 50 mL means ref.quantity = 50). Price per rescaled
  // unit = (price * refQty) / ref.quantity.
  const ref = convert(refQty, CONVERT_BASE[baseUnit]).to("best", "metric")
  const pricePerRescaled = (pricePerBaseUnit * refQty) / ref.quantity
  return `${currency} ${priceNumberFormatter.format(pricePerRescaled)}/${prettyUnit(ref.unit)}`
}

/**
 * Parse a human-entered quantity string (`"100 ml"`, `"5.5 km"`, `"1,5 kg"`)
 * and return the value in `baseUnit`. Returns `null` if the string can't be
 * parsed or the unit doesn't belong to `baseUnit`'s dimension.
 *
 * Accepts both `.` and `,` as decimal separators (German locale).
 */
export function parseQuantity(
  input: string,
  baseUnit: BaseUnit,
): number | null {
  if (typeof input !== "string") return null
  const trimmed = input.trim()
  if (trimmed.length === 0) return null
  const match = trimmed.match(/^([+-]?[\d.,]+)\s*([a-zA-Zµ²\d]+\.?)?$/)
  if (!match) return null
  const numStr = match[1].replace(",", ".")
  const value = Number(numStr)
  if (!Number.isFinite(value)) return null
  const rawUnit = (match[2] ?? "").toLowerCase().trim()
  // No unit provided → assume the value is already in the base unit.
  if (rawUnit.length === 0) return value
  const aliases = PARSE_ALIASES[baseUnit]
  const mappedUnit = aliases[rawUnit]
  if (!mappedUnit) return null
  return convert(value, mappedUnit).to(CONVERT_BASE[baseUnit])
}

/**
 * Format a non-SI count (Stk., Layer, Cuts). Uses the locale's thousands
 * separator and appends the singular label (German UI convention does not
 * pluralise `Stk.` or `Layer`).
 *
 * Examples:
 * - `formatCount(7, "Layer")`     → "7 Layer"
 * - `formatCount(1234, "Layer")`  → "1’234 Layer"  (de-CH apostrophe separator)
 */
const countFormatter = new Intl.NumberFormat(locale, {
  maximumFractionDigits: 0,
})

export function formatCount(value: number, label: string): string {
  if (!Number.isFinite(value)) return ""
  return `${countFormatter.format(value)} ${label}`
}

// ---------------------------------------------------------------------------
// Internal helpers used by pricing-calc.ts to convert raw form inputs (cm,
// g, ml) into the stored base unit. Kept here so the storage convention
// table above stays the only source of truth.
// ---------------------------------------------------------------------------

/** cm → m */
export function cmToMeters(cm: number): number {
  return convert(cm, "cm").to("m")
}

/** g → kg */
export function gramsToKg(g: number): number {
  return convert(g, "g").to("kg")
}

/** ml → l */
export function mlToLiters(ml: number): number {
  return convert(ml, "ml").to("l")
}

/** Two cm dimensions → m² */
export function cmDimensionsToSquareMeters(lengthCm: number, widthCm: number): number {
  return convert(lengthCm * widthCm, "cm2").to("m2")
}
