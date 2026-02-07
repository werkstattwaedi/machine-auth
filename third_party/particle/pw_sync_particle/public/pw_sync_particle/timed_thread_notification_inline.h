// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT
//
// pw_sync timed_thread_notification backend inline implementations for Particle Device OS

#pragma once

#include "pw_chrono/system_clock.h"
#include "pw_sync/timed_thread_notification.h"

namespace pw::sync {

inline bool TimedThreadNotification::try_acquire_for(
    chrono::SystemClock::duration timeout) {
  return try_acquire_until(chrono::SystemClock::now() + timeout);
}

}  // namespace pw::sync
