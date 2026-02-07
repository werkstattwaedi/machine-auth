// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT
//
// pw_thread yield inline implementation for Particle Device OS

#pragma once

#include "concurrent_hal.h"
#include "pw_thread/yield.h"

namespace pw::this_thread {

inline void yield() noexcept {
  os_thread_yield();
}

}  // namespace pw::this_thread
