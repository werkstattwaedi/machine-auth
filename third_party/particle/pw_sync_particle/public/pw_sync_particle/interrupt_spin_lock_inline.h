// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include "pw_sync/interrupt_spin_lock.h"

namespace pw::sync {

constexpr InterruptSpinLock::InterruptSpinLock() : native_type_{} {}

inline InterruptSpinLock::native_handle_type
InterruptSpinLock::native_handle() {
  return native_type_;
}

}  // namespace pw::sync
