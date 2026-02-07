// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT
//
// pw_thread sleep inline implementation for Particle Device OS

#pragma once

#include "pw_chrono/system_clock.h"
#include "pw_thread/sleep.h"

namespace pw::this_thread {

inline void sleep_until(chrono::SystemClock::time_point wakeup_time) {
  return sleep_for(wakeup_time - chrono::SystemClock::now());
}

}  // namespace pw::this_thread
