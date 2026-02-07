// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT
//
// pw_chrono system_clock backend implementation for Particle Device OS

#include "pw_chrono/system_clock.h"

#include "timer_hal.h"

namespace pw::chrono::backend {

int64_t GetSystemClockTickCount() {
  // hal_timer_millis returns milliseconds since boot as 64-bit value
  // Our tick period is 1ms, so we can return it directly
  return static_cast<int64_t>(hal_timer_millis(nullptr));
}

}  // namespace pw::chrono::backend
