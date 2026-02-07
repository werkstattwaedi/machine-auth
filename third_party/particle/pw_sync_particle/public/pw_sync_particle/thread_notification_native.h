// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT
//
// pw_sync thread_notification backend native type for Particle Device OS

#pragma once

#include "concurrent_hal.h"

namespace pw::sync::backend {

// Use a binary semaphore for thread notification.
// os_thread_wait/notify are not available in dynalib, but os_semaphore_* are.
struct NativeThreadNotification {
  os_semaphore_t semaphore;
  bool initialized;
};
using NativeThreadNotificationHandle = NativeThreadNotification&;

}  // namespace pw::sync::backend
