// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Production firmware entry point. The application itself lives in the shared
// //maco_firmware/apps/app_main library (see ADR-0040); prod differs from dev
// only in the AppConfig it passes: it does NOT wait for a USB serial console at
// boot (no console is attached in the field), and arms the hardware watchdog so
// a wedged terminal self-recovers.

#include "maco_firmware/apps/app_main/app_main.h"

int main() {
  maco::apps::RunApp(maco::apps::AppConfig{
      .wait_for_usb_serial = false,
      // TODO(ADR-0040 step 4): flip to true once the supervised watchdog feed
      // and the rapid-reset guard land.
      .enable_watchdog = false,
  });
  // RunApp never returns.
}
