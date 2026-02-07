// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// C++ implementations of the C API test wrappers for TimedMutex.
// The particle backends use C++ headers that are not C-compatible.

#include "pw_sync/timed_mutex.h"

extern "C" {

void pw_sync_TimedMutex_CallLock(pw_sync_TimedMutex* mutex) {
  reinterpret_cast<pw::sync::TimedMutex*>(mutex)->lock();
}

bool pw_sync_TimedMutex_CallTryLock(pw_sync_TimedMutex* mutex) {
  return reinterpret_cast<pw::sync::TimedMutex*>(mutex)->try_lock();
}

bool pw_sync_TimedMutex_CallTryLockFor(pw_sync_TimedMutex* mutex,
                                       pw_chrono_SystemClock_Duration timeout) {
  return reinterpret_cast<pw::sync::TimedMutex*>(mutex)->try_lock_for(
      pw::chrono::SystemClock::duration(timeout.ticks));
}

bool pw_sync_TimedMutex_CallTryLockUntil(
    pw_sync_TimedMutex* mutex, pw_chrono_SystemClock_TimePoint deadline) {
  return reinterpret_cast<pw::sync::TimedMutex*>(mutex)->try_lock_until(
      pw::chrono::SystemClock::time_point(pw::chrono::SystemClock::duration(
          deadline.duration_since_epoch.ticks)));
}

void pw_sync_TimedMutex_CallUnlock(pw_sync_TimedMutex* mutex) {
  reinterpret_cast<pw::sync::TimedMutex*>(mutex)->unlock();
}

}  // extern "C"
