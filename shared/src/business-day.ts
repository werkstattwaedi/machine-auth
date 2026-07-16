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

/**
 * The number of whole business days between `from` and `to` — i.e. how many
 * 03:00 boundaries separate them. `0` when both fall on the same business day,
 * `1` when `to` is on the business day after `from`, negative when `to`
 * precedes `from`.
 *
 * Counts calendar business days, not elapsed 24h spans, so a DST-transition
 * week (CET→CEST) is 7 business days, not 6.958. Used by the stale-checkout
 * reminder cron (#531) to compare a checkout's stale-age against configured
 * business-day offsets — the same "business day" the terminal gate uses.
 */
export function businessDaysBetween(
  from: Date,
  to: Date,
  timeZone: string = WORKSHOP_TIMEZONE,
): number {
  return keyToOrdinal(businessDayKey(to, timeZone)) -
    keyToOrdinal(businessDayKey(from, timeZone))
}

/**
 * The UTC instant at which the business day containing `date` began — i.e.
 * {@link BUSINESS_DAY_START_HOUR} (03:00) in the workshop timezone on that
 * business day's calendar date. Used as an indexed `created <` query bound
 * to prefilter checkouts that are stale by at least one business day (#531)
 * without scanning the whole collection.
 */
export function businessDayStart(
  date: Date,
  timeZone: string = WORKSHOP_TIMEZONE,
): Date {
  const key = businessDayKey(date, timeZone)
  const [year, month, day] = key.split("-").map((s) => Number.parseInt(s, 10))
  // Treat 03:00 on the boundary date as if it were UTC, then correct by the
  // zone's offset at that instant. 03:00 local never lands on a DST gap
  // (spring-forward skips 02:00→03:00, so 03:00 always exists), so a single
  // offset correction is exact.
  const naiveUtc = Date.UTC(year, month - 1, day, BUSINESS_DAY_START_HOUR, 0, 0)
  const offsetMs = zoneOffsetMs(new Date(naiveUtc), timeZone)
  return new Date(naiveUtc - offsetMs)
}

/** Ordinal day number (days since Unix epoch) for a `YYYY-MM-DD` key. */
function keyToOrdinal(key: string): number {
  const [year, month, day] = key.split("-").map((s) => Number.parseInt(s, 10))
  return Math.round(Date.UTC(year, month - 1, day) / 86_400_000)
}

/**
 * The signed offset (local wall-clock minus UTC) of `timeZone` at `instant`,
 * in milliseconds. `+7200000` for Zurich in CEST, `+3600000` in CET.
 */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const { year, month, day, hour } = zonedParts(instant, timeZone)
  const min = Number.parseInt(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      minute: "2-digit",
      hour12: false,
    })
      .formatToParts(instant)
      .find((p) => p.type === "minute")?.value ?? "0",
    10,
  )
  const asUtc = Date.UTC(year, month - 1, day, hour, min, 0)
  return asUtc - instant.getTime()
}

function formatKey(year: number, month: number, day: number): string {
  const mm = String(month).padStart(2, "0")
  const dd = String(day).padStart(2, "0")
  return `${year}-${mm}-${dd}`
}
