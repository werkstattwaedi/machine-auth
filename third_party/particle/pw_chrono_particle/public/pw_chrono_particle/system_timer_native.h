// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT
//
// pw_chrono system_timer backend native type for Particle Device OS

#pragma once

#include "concurrent_hal.h"
#include "pw_chrono/system_clock.h"
#include "pw_function/function.h"

namespace pw::chrono::backend {

struct NativeSystemTimer {
  os_timer_t timer;
  enum class State {
    // Timer is not scheduled.
    kCancelled = 0,
    // Timer is scheduled.
    kScheduled = 1,
  };
  State state;
  SystemClock::time_point expiry_deadline;
  Function<void(SystemClock::time_point expired_deadline)> user_callback;
};
using NativeSystemTimerHandle = NativeSystemTimer&;

}  // namespace pw::chrono::backend
