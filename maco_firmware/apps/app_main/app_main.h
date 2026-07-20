// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include "pw_chrono/system_clock.h"

namespace maco::apps {

/// Runtime configuration that distinguishes the firmware build flavors.
///
/// Dev and prod run the *same* application (see ADR-0040); they differ only in
/// boot policy, so the difference is a small config struct passed into RunApp()
/// rather than a fork of the app code.
struct AppConfig {
  /// Block up to 10 s at boot waiting for a USB serial console so a developer
  /// sees early logs. Dev: true. Production terminals have no console attached,
  /// so prod leaves this false and boots without the delay.
  bool wait_for_usb_serial = false;

  /// Arm the hardware watchdog after AppInit so a wedged terminal self-recovers
  /// (prod). See ADR-0040 for the supervised-feed design.
  bool enable_watchdog = false;

  /// Watchdog timeout used when enable_watchdog is true; ignored otherwise.
  pw::chrono::SystemClock::duration watchdog_timeout =
      pw::chrono::SystemClock::duration::zero();
};

/// Runs the MACO terminal application with the given configuration: performs
/// target + app initialization, then starts the system scheduler. Never
/// returns. Call from `main()`.
[[noreturn]] void RunApp(const AppConfig& config);

}  // namespace maco::apps
