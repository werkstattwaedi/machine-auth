// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT
//
// Particle Device OS replacement for pw_system's scheduler startup.
// On Particle, the scheduler is already running when user code starts,
// so we just need to sleep forever instead of calling vTaskStartScheduler().
//
// We also pump the Device OS application event queue here. Events posted via
// system_notify_event() (network_status, cloud_status, time_changed, etc.)
// are queued to the application thread and only delivered when that thread
// calls system_delay_ms() or spark_process(). Without this, system event
// handlers registered via system_subscribe_event() would never fire.

#include "system_task.h"

namespace pw::system {

// This replaces the FreeRTOS version in pw_system/threads.cc
// On Particle Device OS, the scheduler is already running.
[[noreturn]] void StartSchedulerAndClobberTheStack() {
  // Pump the Device OS application event queue indefinitely.
  // system_delay_ms with no_background_loop=false processes queued system
  // events (network, cloud, time) in addition to sleeping.
  while (true) {
    system_delay_ms(100, false);
  }
}

}  // namespace pw::system
