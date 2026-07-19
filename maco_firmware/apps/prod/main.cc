// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Production firmware entry point. The application itself lives in the shared
// //maco_firmware/apps/app_main library (see ADR-0040); prod differs from dev
// only in the AppConfig it passes: it does NOT wait for a USB serial console at
// boot (no console is attached in the field), and arms the hardware watchdog so
// a wedged terminal self-recovers.

#include <chrono>

#include "maco_firmware/apps/app_main/app_main.h"

int main() {
  maco::apps::RunApp(maco::apps::AppConfig{
      .wait_for_usb_serial = false,
      .enable_watchdog = true,
      // 30s comfortably clears the bounded gateway RPC stalls (5-10s) so a slow
      // cloud round-trip can't false-trip, while recovering a wedged terminal in
      // well under a minute (ADR-0040).
      .watchdog_timeout = std::chrono::seconds(30),
  });
  // RunApp never returns.
}
