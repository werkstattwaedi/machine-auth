// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <cstdint>

namespace pw::sync::backend {

// Native interrupt spin lock state for Particle Device OS.
// Stores the interrupt state to restore later.
struct NativeInterruptSpinLock {
  volatile bool locked = false;
  int32_t saved_state = 0;
};

using NativeInterruptSpinLockHandle = NativeInterruptSpinLock&;

}  // namespace pw::sync::backend
