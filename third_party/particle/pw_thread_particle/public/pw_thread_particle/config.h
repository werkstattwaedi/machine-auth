// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <cstddef>
#include <cstdint>

// Configuration options for pw_thread_particle

namespace pw::thread::particle::config {

// Default stack size in bytes for dynamically allocated threads.
inline constexpr size_t kDefaultStackSizeBytes = 4096;

// Device OS priorities typically range from 0-9 (OS_THREAD_PRIORITY_LOWEST
// to OS_THREAD_PRIORITY_CRITICAL), with higher numbers being higher priority.
inline constexpr uint8_t kLowestPriority = 0;   // OS_THREAD_PRIORITY_LOWEST
inline constexpr uint8_t kHighestPriority = 9;  // OS_THREAD_PRIORITY_CRITICAL
inline constexpr uint8_t kDefaultPriority = 2;  // OS_THREAD_PRIORITY_DEFAULT

// Minimum stack size in bytes.
inline constexpr size_t kMinimumStackSizeBytes = 1024;

}  // namespace pw::thread::particle::config

// Enable joining by default since Device OS supports os_thread_join.
#ifndef PW_THREAD_JOINING_ENABLED
#define PW_THREAD_JOINING_ENABLED 1
#endif
