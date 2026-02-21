// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <cstdint>

namespace maco::time {

// Broken-down local time for UI display.
struct LocalTime {
  int16_t year;   // Full year (e.g. 2026)
  uint8_t month;  // 1-12
  uint8_t day;    // 1-31
  uint8_t hour;   // 0-23
  uint8_t minute; // 0-59

  bool operator==(const LocalTime&) const = default;
};

}  // namespace maco::time
