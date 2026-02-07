// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT
//
// pw_sync binary_semaphore backend inline implementations for Particle Device OS

#pragma once

#include "concurrent_hal.h"
#include "pw_assert/assert.h"
#include "pw_chrono/system_clock.h"
#include "pw_sync/binary_semaphore.h"

namespace pw::sync {

inline BinarySemaphore::BinarySemaphore() : native_type_(nullptr) {
  // Create a binary semaphore: max_count=1, initial_count=0 (starts empty)
  int result = os_semaphore_create(&native_type_, 1, 0);
  PW_DASSERT(result == 0);
}

inline BinarySemaphore::~BinarySemaphore() {
  if (native_type_ != nullptr) {
    os_semaphore_destroy(native_type_);
  }
}

inline void BinarySemaphore::release() {
  // Give (post) the semaphore. The reserved parameter is not used.
  // It's fine if the semaphore already has a count of 1.
  os_semaphore_give(native_type_, false);
}

inline void BinarySemaphore::acquire() {
  // Take (wait) the semaphore indefinitely.
  // CONCURRENT_WAIT_FOREVER is (system_tick_t)-1
  int result = os_semaphore_take(native_type_, CONCURRENT_WAIT_FOREVER, false);
  PW_DASSERT(result == 0);
}

inline bool BinarySemaphore::try_acquire() noexcept {
  // Try to take with zero timeout (non-blocking).
  return os_semaphore_take(native_type_, 0, false) == 0;
}

inline bool BinarySemaphore::try_acquire_until(
    chrono::SystemClock::time_point deadline) {
  return try_acquire_for(deadline - chrono::SystemClock::now());
}

inline BinarySemaphore::native_handle_type BinarySemaphore::native_handle() {
  return native_type_;
}

}  // namespace pw::sync
