// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT
//
// pw_thread ID inline implementation for Particle Device OS

#pragma once

#include "concurrent_hal.h"
#include "pw_thread/id.h"

namespace pw::this_thread {

inline thread::Id get_id() noexcept {
  return thread::Id(os_thread_current(nullptr));
}

}  // namespace pw::this_thread
