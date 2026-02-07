// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include "pw_chrono/system_clock.h"
#include "pw_chrono/system_timer.h"

namespace pw::chrono {

inline void SystemTimer::InvokeAfter(SystemClock::duration delay) {
  InvokeAt(SystemClock::TimePointAfterAtLeast(delay));
}

inline SystemTimer::native_handle_type SystemTimer::native_handle() {
  return native_type_;
}

}  // namespace pw::chrono
