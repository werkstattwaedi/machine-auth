// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT
//
// Watchdog wrapper for Particle Device OS HAL

#pragma once

#include <cstdint>

#include "pw_chrono/system_clock.h"
#include "pw_status/status.h"

namespace pb::watchdog {

// Watchdog timer wrapper using Device OS HAL
//
// Usage:
//   Watchdog wdt;
//   wdt.Enable(std::chrono::seconds(10));
//
//   while (true) {
//     DoWork();
//     wdt.Feed();  // Reset watchdog timer
//   }
//
class Watchdog {
 public:
  // Callback type for watchdog expiration notification
  using ExpiredCallback = void (*)(void* context);

  Watchdog() = default;
  ~Watchdog();

  // Non-copyable
  Watchdog(const Watchdog&) = delete;
  Watchdog& operator=(const Watchdog&) = delete;

  // Enable the watchdog with the specified timeout
  // The system will reset if Feed() is not called within the timeout period
  pw::Status Enable(pw::chrono::SystemClock::duration timeout);

  // Convenience overload for milliseconds
  pw::Status Enable(uint32_t timeout_ms);

  // Disable the watchdog (may not be supported on all hardware)
  pw::Status Disable();

  // Feed (kick) the watchdog to prevent timeout
  // Must be called periodically, more frequently than the timeout
  pw::Status Feed();

  // Set a callback to be called when watchdog is about to expire
  // Note: Callback runs in interrupt context, keep it short!
  pw::Status SetExpiredCallback(ExpiredCallback callback, void* context);

  // Check if watchdog is currently enabled
  bool IsEnabled() const { return enabled_; }

  // Get the configured timeout
  uint32_t GetTimeoutMs() const { return timeout_ms_; }

 private:
  bool enabled_ = false;
  uint32_t timeout_ms_ = 0;
};

}  // namespace pb::watchdog
