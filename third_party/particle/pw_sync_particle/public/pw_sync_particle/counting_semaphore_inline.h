// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT
//
// pw_sync counting_semaphore backend inline implementations for Particle Device OS

#pragma once

#include "concurrent_hal.h"
#include "pw_assert/assert.h"
#include "pw_chrono/system_clock.h"
#include "pw_sync/counting_semaphore.h"

namespace pw::sync {

inline CountingSemaphore::CountingSemaphore() : native_type_(nullptr) {
  // Create a counting semaphore with max() count, starting at 0 (empty).
  // Note: os_semaphore_create uses unsigned int for max_count.
  int result = os_semaphore_create(
      &native_type_,
      static_cast<unsigned>(max()),
      0);
  PW_DASSERT(result == 0);
}

inline CountingSemaphore::~CountingSemaphore() {
  if (native_type_ != nullptr) {
    os_semaphore_destroy(native_type_);
  }
}

inline void CountingSemaphore::acquire() {
  // Take (wait) the semaphore indefinitely.
  int result = os_semaphore_take(native_type_, CONCURRENT_WAIT_FOREVER, false);
  PW_DASSERT(result == 0);
}

inline bool CountingSemaphore::try_acquire() noexcept {
  // Try to take with zero timeout (non-blocking).
  return os_semaphore_take(native_type_, 0, false) == 0;
}

inline bool CountingSemaphore::try_acquire_until(
    chrono::SystemClock::time_point deadline) {
  return try_acquire_for(deadline - chrono::SystemClock::now());
}

inline CountingSemaphore::native_handle_type
CountingSemaphore::native_handle() {
  return native_type_;
}

}  // namespace pw::sync
