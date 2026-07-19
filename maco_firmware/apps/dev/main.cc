// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Development firmware entry point. The application itself lives in the shared
// //maco_firmware/apps/app_main library (see ADR-0040); dev differs from prod
// only in the AppConfig it passes: it waits for a USB serial console at boot so
// a developer sees early logs, and does not arm the watchdog.

#include "maco_firmware/apps/app_main/app_main.h"

int main() {
  maco::apps::RunApp(maco::apps::AppConfig{
      .wait_for_usb_serial = true,
      .enable_watchdog = false,
  });
  // RunApp never returns.
}
