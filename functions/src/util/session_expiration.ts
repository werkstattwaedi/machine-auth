import { Timestamp } from "firebase-admin/firestore";
import { toZonedTime, fromZonedTime } from "date-fns-tz";
import {
  addDays,
  setHours,
  setMinutes,
  setSeconds,
  setMilliseconds,
} from "date-fns";

/**
 * Calculates the expiration time for a session (3am the next day in configured timezone)
 * @param startTime The session start time
 * @param timezone The timezone to use (defaults to Europe/Zurich if not configured)
 * @returns The expiration timestamp
 */
export function calculateSessionExpiration(
  startTime: Timestamp,
  timezone?: string
): Timestamp {
  const tz = timezone || process.env.SESSION_TIMEZONE || "Europe/Zurich";

  const startDate = startTime.toDate();

  // Convert UTC start time to the target timezone
  const startInTimezone = toZonedTime(startDate, tz);

  // Determine the expiration day
  let expirationDay: Date;
  if (startInTimezone.getHours() >= 3) {
    // If it's 3 AM or later, expire at 3 AM the next day
    expirationDay = addDays(startInTimezone, 1);
  } else {
    // If it's before 3 AM, expire at 3 AM the same day
    expirationDay = startInTimezone;
  }

  // Set the expiration time to exactly 3:00:00.000 AM in the target timezone
  let expirationInTimezone = setHours(expirationDay, 3);
  expirationInTimezone = setMinutes(expirationInTimezone, 0);
  expirationInTimezone = setSeconds(expirationInTimezone, 0);
  expirationInTimezone = setMilliseconds(expirationInTimezone, 0);

  // Convert the zoned time back to UTC
  const expirationUtc = fromZonedTime(expirationInTimezone, tz);

  return Timestamp.fromDate(expirationUtc);
}

/**
 * Checks if a session has expired based on its start time
 * @param startTime The session start time
 * @param timezone The timezone to use (defaults to Europe/Zurich if not configured)
 * @returns True if the session has expired, false otherwise
 */
export function isSessionExpired(
  startTime: Timestamp,
  timezone?: string
): boolean {
  const expiration = calculateSessionExpiration(startTime, timezone);
  const now = Timestamp.now();

  return now.toMillis() >= expiration.toMillis();
}
