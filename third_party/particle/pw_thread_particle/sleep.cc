// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "pw_thread/sleep.h"

#include <algorithm>

#include "concurrent_hal.h"
#include "delay_hal.h"
#include "pw_chrono/system_clock.h"

using pw::chrono::SystemClock;

namespace pw::this_thread {

void sleep_for(SystemClock::duration sleep_duration) {
  // Yield for negative and zero length durations
  if (sleep_duration <= SystemClock::duration::zero()) {
    os_thread_yield();
    return;
  }

  // Convert duration to milliseconds
  auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(sleep_duration);

  // HAL_Delay_Milliseconds takes uint32_t, so handle very long sleeps
  constexpr uint32_t kMaxDelayMs = 0xFFFFFFFFU;

  int64_t remaining_ms = ms.count();
  while (remaining_ms > 0) {
    uint32_t delay_ms = static_cast<uint32_t>(
        std::min<int64_t>(remaining_ms, kMaxDelayMs));
    HAL_Delay_Milliseconds(delay_ms);
    remaining_ms -= delay_ms;
  }
}

}  // namespace pw::this_thread
