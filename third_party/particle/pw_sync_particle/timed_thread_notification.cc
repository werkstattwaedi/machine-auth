// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "pw_sync/timed_thread_notification.h"

#include <algorithm>

#include "concurrent_hal.h"
#include "pw_assert/check.h"
#include "pw_chrono/system_clock.h"

using pw::chrono::SystemClock;

namespace pw::sync {

// Lazy initialization of the semaphore (same as thread_notification.cc)
static void EnsureInitialized(backend::NativeThreadNotification& native_type) {
  if (!native_type.initialized) {
    // Create a binary semaphore with max_count=1, initial_count=0
    int result = os_semaphore_create(&native_type.semaphore, 1, 0);
    PW_CHECK(result == 0, "Failed to create semaphore");
    native_type.initialized = true;
  }
}

bool TimedThreadNotification::try_acquire_until(
    const SystemClock::time_point deadline) {
  EnsureInitialized(native_handle());

  // Check if deadline already passed
  SystemClock::time_point now = SystemClock::now();
  if (now >= deadline) {
    // Try to acquire without blocking
    int result = os_semaphore_take(native_handle().semaphore, 0, false);
    return result == 0;
  }

  // Calculate timeout in milliseconds, rounding UP to ensure we wait at least
  // as long as requested.
  const auto timeout_duration = deadline - now;
  const int64_t timeout_ms =
      std::chrono::ceil<std::chrono::milliseconds>(timeout_duration).count();

  // Clamp to valid range
  constexpr int64_t kMaxTimeoutMs =
      static_cast<int64_t>(CONCURRENT_WAIT_FOREVER) - 1;
  const system_tick_t wait_ms =
      static_cast<system_tick_t>(std::min(timeout_ms, kMaxTimeoutMs));

  // Wait for semaphore with timeout
  int result = os_semaphore_take(native_handle().semaphore, wait_ms, false);
  return result == 0;
}

}  // namespace pw::sync
