// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT
//
// Thread stack backend for Particle Device OS.
#pragma once

#include <array>
#include <cstddef>
#include <cstdint>

#include "pw_thread_particle/config.h"

namespace pw::thread::backend {

inline constexpr size_t kDefaultStackSizeBytes =
    ::pw::thread::particle::config::kDefaultStackSizeBytes;

// Particle Device OS uses byte-aligned stacks.
template <size_t kStackSizeBytes>
using Stack = std::array<uint8_t, kStackSizeBytes>;

}  // namespace pw::thread::backend
