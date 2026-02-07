// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT
//
// pw_sync mutex backend native type for Particle Device OS.
//
// Implementation note: Uses a binary semaphore (max=1, initial=1) instead of
// os_mutex_t to enable TimedMutex to use os_semaphore_take with timeout.
// Trade-off: Binary semaphores lack priority inheritance that mutexes provide.

#pragma once

namespace pw::sync::backend {

// os_semaphore_t in Device OS is void* (handle to FreeRTOS semaphore).
// We use a binary semaphore configured as mutex (max=1, initial=1).
using NativeMutex = void*;
using NativeMutexHandle = NativeMutex&;

}  // namespace pw::sync::backend
