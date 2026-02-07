// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT
//
// pw_chrono system_clock backend configuration for Particle Device OS

#pragma once

#include "pw_chrono/epoch.h"

// System clock period: 1 millisecond (1/1000 second)
// hal_timer_millis() returns milliseconds since boot
#define PW_CHRONO_SYSTEM_CLOCK_PERIOD_SECONDS_NUMERATOR 1
#define PW_CHRONO_SYSTEM_CLOCK_PERIOD_SECONDS_DENOMINATOR 1000

namespace pw::chrono::backend {

// Epoch is time since boot (unknown point in time)
inline constexpr Epoch kSystemClockEpoch = Epoch::kUnknown;

// The clock continues to run even in critical sections
// (Device OS timer is hardware-based)
inline constexpr bool kSystemClockFreeRunning = true;

// Not safe to call from NMI context
inline constexpr bool kSystemClockNmiSafe = false;

}  // namespace pw::chrono::backend
