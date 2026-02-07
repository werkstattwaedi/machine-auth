// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT
//
// Thread priority backend for Particle Device OS.
#pragma once

#include <cstdint>

#include "pw_thread_particle/config.h"

namespace pw::thread::backend {

using PriorityType = uint8_t;

inline constexpr PriorityType kLowestPriority =
    ::pw::thread::particle::config::kLowestPriority;
inline constexpr PriorityType kHighestPriority =
    ::pw::thread::particle::config::kHighestPriority;
inline constexpr PriorityType kDefaultPriority =
    ::pw::thread::particle::config::kDefaultPriority;

}  // namespace pw::thread::backend
