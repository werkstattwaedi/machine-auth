// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

// Placeholder Zurich timezone (CET/CEST) with automatic DST.
//
// EU DST rules:
//   - Last Sunday of March at 01:00 UTC  → CEST (+2h)
//   - Last Sunday of October at 01:00 UTC → CET  (+1h)
//
// TODO: Replace with a proper timezone library when multi-timezone support
// is needed.

#include <ctime>

namespace maco::time {

// Returns the day-of-month of the last Sunday in the given month/year.
inline int LastSundayOf(int year, int month) {
  std::tm t{};
  t.tm_year = year - 1900;
  t.tm_mon = month;  // month (0-based); day 0 = last day of previous month
  t.tm_mday = 0;
  std::mktime(&t);
  return t.tm_mday - t.tm_wday;  // subtract weekday to reach the last Sunday
}

// Returns true if the given UTC Unix timestamp falls within CEST (DST active).
inline bool IsZurichDst(std::time_t utc) {
  std::tm t{};
  gmtime_r(&utc, &t);
  int y = t.tm_year + 1900, m = t.tm_mon + 1, d = t.tm_mday, h = t.tm_hour;

  if (m < 3 || m > 10) return false;
  if (m > 3 && m < 10) return true;

  int ls = LastSundayOf(y, m);
  if (m == 3) return (d > ls) || (d == ls && h >= 1);  // 01:00 UTC → CEST
  /* m == 10 */ return (d < ls) || (d == ls && h < 1); // 01:00 UTC → CET
}

// Returns the UTC offset in seconds for Zurich at the given UTC timestamp.
inline int ZurichUtcOffsetSeconds(std::time_t utc) {
  return IsZurichDst(utc) ? 2 * 3600 : 1 * 3600;
}

// Converts a UTC Unix timestamp to Zurich local time.
inline std::time_t ZurichLocalTime(std::time_t utc) {
  return utc + ZurichUtcOffsetSeconds(utc);
}

}  // namespace maco::time
