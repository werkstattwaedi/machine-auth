// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// C++ implementations of the C API test wrappers for BinarySemaphore.
// The particle backends use C++ headers that are not C-compatible.

#include "pw_sync/binary_semaphore.h"

extern "C" {

void pw_sync_BinarySemaphore_CallRelease(pw_sync_BinarySemaphore* semaphore) {
  reinterpret_cast<pw::sync::BinarySemaphore*>(semaphore)->release();
}

void pw_sync_BinarySemaphore_CallAcquire(pw_sync_BinarySemaphore* semaphore) {
  reinterpret_cast<pw::sync::BinarySemaphore*>(semaphore)->acquire();
}

bool pw_sync_BinarySemaphore_CallTryAcquire(
    pw_sync_BinarySemaphore* semaphore) {
  return reinterpret_cast<pw::sync::BinarySemaphore*>(semaphore)->try_acquire();
}

bool pw_sync_BinarySemaphore_CallTryAcquireFor(
    pw_sync_BinarySemaphore* semaphore,
    pw_chrono_SystemClock_Duration timeout) {
  return reinterpret_cast<pw::sync::BinarySemaphore*>(semaphore)
      ->try_acquire_for(pw::chrono::SystemClock::duration(timeout.ticks));
}

bool pw_sync_BinarySemaphore_CallTryAcquireUntil(
    pw_sync_BinarySemaphore* semaphore,
    pw_chrono_SystemClock_TimePoint deadline) {
  return reinterpret_cast<pw::sync::BinarySemaphore*>(semaphore)
      ->try_acquire_until(pw::chrono::SystemClock::time_point(
          pw::chrono::SystemClock::duration(
              deadline.duration_since_epoch.ticks)));
}

ptrdiff_t pw_sync_BinarySemaphore_CallMax() {
  return pw::sync::BinarySemaphore::max();
}

}  // extern "C"
