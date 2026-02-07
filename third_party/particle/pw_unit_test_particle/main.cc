// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT
//
// Particle test main using HAL functions only (no Wiring API).
// Called via pigweed_entry.cc: setup() -> main() -> runs tests, then idles.
//
// This provides the main() function that pigweed_entry.cc expects.
// Unlike pw_system apps, we return from setup tests but then idle forever
// so the user can see results on the serial monitor.

#include <string_view>

#include "pw_span/span.h"
#include "pw_sys_io/sys_io.h"
#include "pw_unit_test/framework.h"
#include "pw_unit_test/simple_printing_event_handler.h"

// Particle HAL includes (exported via dynalib)
#include "delay_hal.h"
#include "usb_hal.h"

namespace {

constexpr HAL_USB_USART_Serial kSerial = HAL_USB_USART_SERIAL;

void WriteToSerial(std::string_view s, bool newline) {
  if (newline) {
    pw::sys_io::WriteLine(s).IgnoreError();
  } else {
    pw::sys_io::WriteBytes(pw::as_bytes(pw::span(s))).IgnoreError();
  }
}

}  // namespace

// Called by pigweed_entry.cc from setup()
int main() {
  // Wait for USB serial connection before running tests
  while (!HAL_USB_USART_Is_Connected(kSerial)) {
    HAL_Delay_Milliseconds(100);
  }
  // Brief delay for terminal to stabilize
  HAL_Delay_Milliseconds(500);

  // Set up test event handler
  pw::unit_test::SimplePrintingEventHandler handler(WriteToSerial);
  pw::unit_test::RegisterEventHandler(&handler);

  // Run all tests
  int result = RUN_ALL_TESTS();

  // Signal completion with clear banner
  pw::sys_io::WriteLine(result == 0 ? "\n=== ALL TESTS PASSED ==="
                                     : "\n=== TESTS FAILED ===")
      .IgnoreError();

  // Idle forever so user can see results (Ctrl+C to exit serial monitor)
  while (true) {
    HAL_Delay_Milliseconds(1000);
  }

  return result;
}
