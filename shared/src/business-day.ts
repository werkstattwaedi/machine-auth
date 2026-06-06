// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Workshop "business day" helpers.
 *
 * A business day runs from 03:00 to 03:00 the next day, in the workshop's
 * local timezone (Europe/Zurich). The 03:00 boundary (rather than midnight)
 * means a late-night visitor who taps out at 02:00 still belongs to the
 * *previous* calendar day — see issue #268.
 *
 * Used by the daily-usage-fee dedup: an entry fee is billed at most once
 * per business day per (named) person. The server computes the business-day
 * key at checkout-close time and compares it against prior closed checkouts.
 *
 * Implemented with the built-in `Intl.DateTimeFormat` so this stays
 * dependency-free and usable from web, functions, and the Electron kiosk
 * (@oww/shared carries no runtime deps).
 */

/** The workshop timezone. Single-region product, so this is a constant. */
const WORKSHOP_TIMEZONE = "Europe/Zurich"

/**
 * The hour (in workshop-local time) at which a new business day starts.
 * 03:00 — a checkout that closes at 02:59 belongs to the day before.
 */
export const BUSINESS_DAY_START_HOUR = 3

interface ZonedParts {
  year: number
  month: number
  day: number
  hour: number
}

/**
 * Decompose `date` into workshop-local Y/M/D/H parts. Uses
 * `Intl.DateTimeFormat` with an explicit IANA zone so DST transitions are
 * handled correctly without a date library.
 */
function zonedParts(date: Date, timeZone: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  })
  const parts = fmt.formatToParts(date)
  const get = (type: string): number => {
    const value = parts.find((p) => p.type === type)?.value ?? "0"
    return Number.parseInt(value, 10)
  }
  // `hour12: false` can render midnight as "24" in some runtimes; normalize.
  let hour = get("hour")
  if (hour === 24) hour = 0
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour,
  }
}

/**
 * The business-day key (`"YYYY-MM-DD"`) for `date`, with the day boundary at
 * {@link BUSINESS_DAY_START_HOUR} (03:00) in the workshop timezone.
 *
 * Two dates that share a key fall on the same business day; the daily-fee
 * dedup treats them as "already paid today". A checkout closing at 02:00
 * yields the *previous* calendar day's key — it belongs to the night before.
 *
 * @param date The instant to classify (a JS `Date`, i.e. UTC instant).
 * @param timeZone Override the workshop timezone (defaults to Europe/Zurich).
 *   Exposed for tests; production always uses the default.
 */
export function businessDayKey(
  date: Date,
  timeZone: string = WORKSHOP_TIMEZONE,
): string {
  const { year, month, day, hour } = zonedParts(date, timeZone)

  // Before the 03:00 boundary the instant belongs to the previous calendar
  // day. Shift the date back one day in a UTC-noon anchor (noon avoids any
  // DST edge near midnight) and re-read the local Y/M/D.
  if (hour < BUSINESS_DAY_START_HOUR) {
    const anchor = new Date(Date.UTC(year, month - 1, day, 12, 0, 0))
    anchor.setUTCDate(anchor.getUTCDate() - 1)
    const y = anchor.getUTCFullYear()
    const m = anchor.getUTCMonth() + 1
    const d = anchor.getUTCDate()
    return formatKey(y, m, d)
  }

  return formatKey(year, month, day)
}

/** True iff `a` and `b` fall on the same workshop business day. */
export function isSameBusinessDay(
  a: Date,
  b: Date,
  timeZone: string = WORKSHOP_TIMEZONE,
): boolean {
  return businessDayKey(a, timeZone) === businessDayKey(b, timeZone)
}

function formatKey(year: number, month: number, day: number): string {
  const mm = String(month).padStart(2, "0")
  const dd = String(day).padStart(2, "0")
  return `${year}-${mm}-${dd}`
}
