// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Shared helpers for formatting dates in the workshop's local timezone.
 *
 * Cloud Functions run in UTC, so any date formatting that should read in
 * Zurich local time (invoice emails, PDF dates, session expiration) must
 * route through here. The timezone is read from the `WORKSHOP_TIMEZONE`
 * environment variable and defaults to `"Europe/Zurich"`.
 */

import { formatInTimeZone } from "date-fns-tz";
import { de } from "date-fns/locale";

/**
 * Resolve the workshop's IANA timezone name.
 *
 * Falls back to `"Europe/Zurich"` when `WORKSHOP_TIMEZONE` is unset.
 */
export function getWorkshopTimezone(): string {
  return process.env.WORKSHOP_TIMEZONE || "Europe/Zurich";
}

/**
 * Format a date in the workshop's timezone using German locale.
 *
 * Thin wrapper over `date-fns-tz`'s `formatInTimeZone` that pins the
 * locale so month names (`MMMM`) render in German and routes the
 * timezone lookup through {@link getWorkshopTimezone}.
 */
export function formatWorkshopDateTime(date: Date, pattern: string): string {
  return formatInTimeZone(date, getWorkshopTimezone(), pattern, { locale: de });
}
