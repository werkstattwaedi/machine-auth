// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT
//
// pw_sync mutex backend inline implementations for Particle Device OS.
//
// Implementation note: Uses a binary semaphore (max=1, initial=1) instead of
// os_mutex_t to enable TimedMutex to use os_semaphore_take with timeout.
// Trade-off: Binary semaphores lack priority inheritance that mutexes provide.

#pragma once

#include "concurrent_hal.h"
#include "pw_assert/assert.h"
#include "pw_sync/mutex.h"

namespace pw::sync {

inline Mutex::Mutex() : native_type_(nullptr) {
  // Create a binary semaphore: max_count=1, initial_count=1 (starts unlocked)
  int result = os_semaphore_create(&native_type_, 1, 1);
  PW_DASSERT(result == 0);
}

inline Mutex::~Mutex() {
  if (native_type_ != nullptr) {
    os_semaphore_destroy(native_type_);
  }
}

inline void Mutex::lock() {
  // Take the semaphore indefinitely.
  int result = os_semaphore_take(native_type_, CONCURRENT_WAIT_FOREVER, false);
  PW_DASSERT(result == 0);
}

inline bool Mutex::try_lock() {
  // Try to take with zero timeout (non-blocking).
  return os_semaphore_take(native_type_, 0, false) == 0;
}

inline void Mutex::unlock() {
  // Give the semaphore.
  int result = os_semaphore_give(native_type_, false);
  PW_ASSERT(result == 0);
}

inline Mutex::native_handle_type Mutex::native_handle() { return native_type_; }

}  // namespace pw::sync
