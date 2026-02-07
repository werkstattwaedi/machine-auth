// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// C++ implementations of the C API test wrappers for Mutex.
// The particle backends use C++ headers that are not C-compatible.

#include "pw_sync/mutex.h"

extern "C" {

void pw_sync_Mutex_CallLock(pw_sync_Mutex* mutex) {
  reinterpret_cast<pw::sync::Mutex*>(mutex)->lock();
}

bool pw_sync_Mutex_CallTryLock(pw_sync_Mutex* mutex) {
  return reinterpret_cast<pw::sync::Mutex*>(mutex)->try_lock();
}

void pw_sync_Mutex_CallUnlock(pw_sync_Mutex* mutex) {
  reinterpret_cast<pw::sync::Mutex*>(mutex)->unlock();
}

}  // extern "C"
