// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT
//
// pw_assert_basic handler for Particle P2 firmware.
// Logs assertion failure and enters safe mode.
//
// Note: PW_ASSERT does not provide location info. Use PW_CHECK for
// file/line/function details in assert output.

#include "pw_assert_basic/handler.h"

#include <cstdarg>
#include <cstdio>

#include "core_hal.h"
#include "delay_hal.h"
#include "pw_log/log.h"
#include "usb_hal.h"

extern "C" {

// Handler called by pw_assert_basic macros when an assertion fails.
void pw_assert_basic_HandleFailure(
    const char* file_name,
    int line_number,
    const char* function_name,
    const char* format,
    ...
) {


  PW_LOG_CRITICAL("=== ASSERT FAILED ===");
  HAL_Delay_Milliseconds(500);


  // Print location if available (PW_CHECK provides this, PW_ASSERT does not)
  if (file_name != nullptr && line_number >= 0) {
    if (function_name != nullptr) {
      PW_LOG_CRITICAL("%s:%d in %s()", file_name, line_number, function_name);
    } else {
      PW_LOG_CRITICAL("%s:%d", file_name, line_number);
    }
  }

  // Print formatted message if provided
  if (format != nullptr) {
    char msg_buffer[200];
    va_list args;
    va_start(args, format);
    vsnprintf(msg_buffer, sizeof(msg_buffer), format, args);
    va_end(args);
    PW_LOG_CRITICAL("%s", msg_buffer);
  }

  PW_LOG_CRITICAL("Entering safe mode...");
  HAL_Delay_Milliseconds(100);

  HAL_Core_Enter_Safe_Mode(nullptr);
}

}  // extern "C"
