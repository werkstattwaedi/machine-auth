// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <chrono>

#include "pw_chrono/system_clock.h"

namespace maco {

/// Starts a low-priority thread that periodically logs stack watermarks
/// for all threads and warns if any thread's headroom drops below 20%.
///
/// Gracefully handles Unimplemented on host (ForEachThread returns
/// Unimplemented for pw_thread_stl).
void StartStackMonitor(
    pw::chrono::SystemClock::duration interval = std::chrono::seconds(30));

}  // namespace maco
