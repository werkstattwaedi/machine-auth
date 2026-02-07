// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "pw_sync/thread_notification.h"

#include "concurrent_hal.h"
#include "pw_assert/check.h"

namespace pw::sync {

// Lazy initialization of the semaphore.
// We can't initialize in the constructor because it's constexpr.
static void EnsureInitialized(backend::NativeThreadNotification& native_type) {
  if (!native_type.initialized) {
    // Create a binary semaphore with max_count=1, initial_count=0
    int result = os_semaphore_create(&native_type.semaphore, 1, 0);
    PW_CHECK(result == 0, "Failed to create semaphore");
    native_type.initialized = true;
  }
}

void ThreadNotification::acquire() {
  EnsureInitialized(native_type_);

  // Wait indefinitely for the semaphore
  int result = os_semaphore_take(native_type_.semaphore,
                                  CONCURRENT_WAIT_FOREVER,
                                  false);  // not from ISR
  PW_CHECK(result == 0, "Semaphore take failed");
}

void ThreadNotification::release() {
  EnsureInitialized(native_type_);

  // Give the semaphore (signal the waiting thread).
  // Note: Returns non-zero if semaphore is already at max (1), which is fine.
  os_semaphore_give(native_type_.semaphore, false);  // not from ISR
}

}  // namespace pw::sync
