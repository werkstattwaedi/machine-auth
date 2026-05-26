// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Session-day boundary helpers — client-side mirror of
 * `functions/src/util/session_expiration.ts` (the 3:00 AM Europe/Zurich
 * rollover). A checkout's "session day" is the local date in the workshop's
 * timezone shifted back 3 hours so that visits crossing midnight stay on
 * one day. Two timestamps on the same session day are "today" relative to
 * each other; a checkout is "stale" once a new session day has begun.
 */

const WORKSHOP_TIMEZONE = "Europe/Zurich"
const ROLLOVER_HOUR = 3

/**
 * Return a stable "YYYY-MM-DD" key identifying the session day a given
 * moment belongs to.
 */
export function sessionDayKey(
  d: Date,
  timezone: string = WORKSHOP_TIMEZONE,
): string {
  const parts = partsInTimezone(d, timezone)
  if (parts.hour < ROLLOVER_HOUR) {
    // Before the 3am rollover → roll the date back by one calendar day
    // in the same timezone.
    const utcMs = Date.UTC(parts.year, parts.month - 1, parts.day) - 86_400_000
    const prev = partsInTimezone(new Date(utcMs), timezone)
    return `${prev.year}-${pad(prev.month)}-${pad(prev.day)}`
  }
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`
}

/**
 * True if `created` predates the current session day in the workshop's
 * timezone. Mirrors the server-side `isSessionExpired` semantics — once
 * the 3am Europe/Zurich rollover has happened, yesterday's open checkout
 * is "stale" and must be settled before a new one can start.
 */
export function isCheckoutStale(
  created: Date,
  now: Date = new Date(),
  timezone: string = WORKSHOP_TIMEZONE,
): boolean {
  return sessionDayKey(created, timezone) !== sessionDayKey(now, timezone)
}

function partsInTimezone(
  d: Date,
  timezone: string,
): { year: number; month: number; day: number; hour: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  })
  const map: Record<string, string> = {}
  for (const part of fmt.formatToParts(d)) {
    map[part.type] = part.value
  }
  return {
    year: parseInt(map.year, 10),
    month: parseInt(map.month, 10),
    day: parseInt(map.day, 10),
    // Intl formats midnight as "24" in en-CA — normalize to 0.
    hour: parseInt(map.hour, 10) % 24,
  }
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}
