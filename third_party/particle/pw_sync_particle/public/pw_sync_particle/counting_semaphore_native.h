// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT
//
// pw_sync counting_semaphore backend native type for Particle Device OS

#pragma once

#include <cstddef>
#include <limits>

namespace pw::sync::backend {

// os_semaphore_t in Device OS is void* (handle to FreeRTOS counting semaphore)
using NativeCountingSemaphore = void*;
using NativeCountingSemaphoreHandle = NativeCountingSemaphore&;

// Device OS semaphores use unsigned int for max_count.
// We use the minimum of ptrdiff_t max and unsigned int max.
inline constexpr ptrdiff_t kCountingSemaphoreMaxValue =
    std::numeric_limits<ptrdiff_t>::max() <
            static_cast<ptrdiff_t>(std::numeric_limits<unsigned int>::max())
        ? std::numeric_limits<ptrdiff_t>::max()
        : static_cast<ptrdiff_t>(std::numeric_limits<unsigned int>::max());

}  // namespace pw::sync::backend
