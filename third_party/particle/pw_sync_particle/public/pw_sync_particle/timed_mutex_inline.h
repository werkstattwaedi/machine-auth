// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT
//
// pw_sync timed_mutex backend inline implementations for Particle Device OS.
//
// TimedMutex inherits from Mutex, so only try_lock_until needs to be defined
// here. try_lock_for is implemented in timed_mutex.cc.

#pragma once

#include "pw_chrono/system_clock.h"
#include "pw_sync/timed_mutex.h"

namespace pw::sync {

inline bool TimedMutex::try_lock_until(
    chrono::SystemClock::time_point deadline) {
  return try_lock_for(deadline - chrono::SystemClock::now());
}

}  // namespace pw::sync
