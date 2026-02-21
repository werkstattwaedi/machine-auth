// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <chrono>

#include "pw_chrono/system_clock.h"

namespace maco {

/// Called once per thread per scan with the thread name and free stack words.
/// Must be a plain function pointer (no captures) — the stack monitor stores
/// it in a file-local static to stay within pw::Function's 4-byte inline limit.
using ThreadWatermarkCallback = void (*)(const char* name, uint32_t free_words);

/// Starts a low-priority thread that periodically logs stack watermarks
/// for all threads and warns if any thread's headroom drops below 20%.
///
/// If per_thread_callback is non-null it is called for every thread after each
/// scan — useful for wiring watermark data into pw_metric gauges.
///
/// Gracefully handles Unimplemented on host (ForEachThread returns
/// Unimplemented for pw_thread_stl).
void StartStackMonitor(
    pw::chrono::SystemClock::duration interval = std::chrono::seconds(30),
    ThreadWatermarkCallback per_thread_callback = nullptr);

}  // namespace maco
