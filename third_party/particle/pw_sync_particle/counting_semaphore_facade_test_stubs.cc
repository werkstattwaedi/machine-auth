// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// C++ implementations of the C API test wrappers for CountingSemaphore.
// The particle backends use C++ headers that are not C-compatible.

#include "pw_sync/counting_semaphore.h"

extern "C" {

void pw_sync_CountingSemaphore_CallRelease(
    pw_sync_CountingSemaphore* semaphore) {
  reinterpret_cast<pw::sync::CountingSemaphore*>(semaphore)->release();
}

void pw_sync_CountingSemaphore_CallReleaseNum(
    pw_sync_CountingSemaphore* semaphore, ptrdiff_t update) {
  reinterpret_cast<pw::sync::CountingSemaphore*>(semaphore)->release(update);
}

void pw_sync_CountingSemaphore_CallAcquire(
    pw_sync_CountingSemaphore* semaphore) {
  reinterpret_cast<pw::sync::CountingSemaphore*>(semaphore)->acquire();
}

bool pw_sync_CountingSemaphore_CallTryAcquire(
    pw_sync_CountingSemaphore* semaphore) {
  return reinterpret_cast<pw::sync::CountingSemaphore*>(semaphore)
      ->try_acquire();
}

bool pw_sync_CountingSemaphore_CallTryAcquireFor(
    pw_sync_CountingSemaphore* semaphore,
    pw_chrono_SystemClock_Duration timeout) {
  return reinterpret_cast<pw::sync::CountingSemaphore*>(semaphore)
      ->try_acquire_for(pw::chrono::SystemClock::duration(timeout.ticks));
}

bool pw_sync_CountingSemaphore_CallTryAcquireUntil(
    pw_sync_CountingSemaphore* semaphore,
    pw_chrono_SystemClock_TimePoint deadline) {
  return reinterpret_cast<pw::sync::CountingSemaphore*>(semaphore)
      ->try_acquire_until(pw::chrono::SystemClock::time_point(
          pw::chrono::SystemClock::duration(
              deadline.duration_since_epoch.ticks)));
}

ptrdiff_t pw_sync_CountingSemaphore_CallMax() {
  return pw::sync::CountingSemaphore::max();
}

}  // extern "C"
