// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "pw_sync/interrupt_spin_lock.h"

#include "hal_irq_flag.h"

namespace pw::sync {

void InterruptSpinLock::lock() {
  // Save the current interrupt state and disable interrupts.
  native_type_.saved_state = HAL_disable_irq();
  native_type_.locked = true;
}

bool InterruptSpinLock::try_lock() {
  // Disable interrupts first to safely check the lock state.
  int saved = HAL_disable_irq();

  if (native_type_.locked) {
    // Already locked, restore interrupts and return failure.
    HAL_enable_irq(saved);
    return false;
  }

  // Not locked, acquire the lock.
  native_type_.saved_state = saved;
  native_type_.locked = true;
  return true;
}

void InterruptSpinLock::unlock() {
  native_type_.locked = false;
  // Restore the previous interrupt state.
  HAL_enable_irq(native_type_.saved_state);
}

}  // namespace pw::sync
