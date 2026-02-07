// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT
//
// pw_sync thread_notification backend inline implementations for Particle Device OS

#pragma once

#include "concurrent_hal.h"
#include "pw_sync/thread_notification.h"

namespace pw::sync {

inline ThreadNotification::ThreadNotification()
    : native_type_{
          .semaphore = nullptr,
          .initialized = false,
      } {}

inline ThreadNotification::~ThreadNotification() {
  if (native_type_.initialized && native_type_.semaphore != nullptr) {
    os_semaphore_destroy(native_type_.semaphore);
  }
}

inline bool ThreadNotification::try_acquire() {
  // Lazy init if needed (can't do in constexpr constructor)
  if (!native_type_.initialized) {
    int result = os_semaphore_create(&native_type_.semaphore, 1, 0);
    if (result != 0) {
      return false;
    }
    native_type_.initialized = true;
  }
  // Try to take with zero timeout (non-blocking)
  return os_semaphore_take(native_type_.semaphore, 0, false) == 0;
}

inline ThreadNotification::native_handle_type
ThreadNotification::native_handle() {
  return native_type_;
}

}  // namespace pw::sync
