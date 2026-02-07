// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT
//
// Particle Device OS replacement for pw_system's scheduler startup.
// On Particle, the scheduler is already running when user code starts,
// so we just need to sleep forever instead of calling vTaskStartScheduler().

#include <chrono>

#include "pw_thread/sleep.h"

namespace pw::system {

// This replaces the FreeRTOS version in pw_system/threads.cc
// On Particle Device OS, the scheduler is already running.
[[noreturn]] void StartSchedulerAndClobberTheStack() {
  // Just keep the calling thread alive. The pw_system threads are already
  // running since they were created before this call.
  while (true) {
    pw::this_thread::sleep_for(std::chrono::hours(24));
  }
}

}  // namespace pw::system
