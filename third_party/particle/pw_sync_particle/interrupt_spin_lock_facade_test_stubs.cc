// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// C++ implementations of the C API test wrappers for InterruptSpinLock.
// The particle backends use C++ headers that are not C-compatible.

#include "pw_sync/interrupt_spin_lock.h"

extern "C" {

void pw_sync_InterruptSpinLock_CallLock(pw_sync_InterruptSpinLock* spin_lock) {
  reinterpret_cast<pw::sync::InterruptSpinLock*>(spin_lock)->lock();
}

bool pw_sync_InterruptSpinLock_CallTryLock(
    pw_sync_InterruptSpinLock* spin_lock) {
  return reinterpret_cast<pw::sync::InterruptSpinLock*>(spin_lock)->try_lock();
}

void pw_sync_InterruptSpinLock_CallUnlock(
    pw_sync_InterruptSpinLock* spin_lock) {
  reinterpret_cast<pw::sync::InterruptSpinLock*>(spin_lock)->unlock();
}

}  // extern "C"
