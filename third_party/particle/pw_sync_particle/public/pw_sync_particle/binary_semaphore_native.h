// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT
//
// pw_sync binary_semaphore backend native type for Particle Device OS

#pragma once

#include <cstddef>
#include <limits>

namespace pw::sync::backend {

// os_semaphore_t in Device OS is void* (handle to FreeRTOS semaphore)
using NativeBinarySemaphore = void*;
using NativeBinarySemaphoreHandle = NativeBinarySemaphore&;

// Device OS semaphores support any count up to UINT_MAX, but for binary
// semaphores we're limited to 1. The max value represents how many times
// release() can be called before overflow.
inline constexpr ptrdiff_t kBinarySemaphoreMaxValue =
    std::numeric_limits<ptrdiff_t>::max();

}  // namespace pw::sync::backend
