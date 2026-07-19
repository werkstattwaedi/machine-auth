// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT
//
// Production pw_assert_basic handler for the P2 firmware (ADR-0040).
//
// Unlike the dev handler (@particle_bazel//pw_assert_particle:handler), which
// logs and enters DeviceOS safe mode (halting the app until a human
// intervenes), this handler logs the failure and then RESETS the device, so an
// unattended production terminal self-recovers instead of dropping into
// recovery mode. The tokenized log lines are emitted before the reset, so the
// diagnosis is preserved even though the halted live state is not. Selected for
// prod via the //maco_firmware/targets/p2:assert_handler select() (--config=prod).
//
// The rapid-reset guard (RecordBoot / kMaxConsecutiveBoots in app_main) bounds
// the reset loop a deterministic assertion failure would otherwise cause.

#include "pw_assert_basic/handler.h"

#include <cstdarg>
#include <cstdio>

#include "core_hal.h"
#include "delay_hal.h"
#include "pw_log/log.h"

extern "C" {

void pw_assert_basic_HandleFailure(
    const char* file_name,
    int line_number,
    const char* function_name,
    const char* format,
    ...
) {
  PW_LOG_CRITICAL("=== ASSERT FAILED ===");
  HAL_Delay_Milliseconds(500);

  // Print location if available (PW_CHECK provides this, PW_ASSERT does not).
  if (file_name != nullptr && line_number >= 0) {
    if (function_name != nullptr) {
      PW_LOG_CRITICAL("%s:%d in %s()", file_name, line_number, function_name);
    } else {
      PW_LOG_CRITICAL("%s:%d", file_name, line_number);
    }
  }

  // Print formatted message if provided.
  if (format != nullptr) {
    char msg_buffer[200];
    va_list args;
    va_start(args, format);
    vsnprintf(msg_buffer, sizeof(msg_buffer), format, args);
    va_end(args);
    PW_LOG_CRITICAL("%s", msg_buffer);
  }

  PW_LOG_CRITICAL("Resetting device...");
  HAL_Delay_Milliseconds(100);  // let the tokenized log drain first

  HAL_Core_System_Reset();
  // HAL_Core_System_Reset() is not annotated noreturn in the HAL headers, but
  // it never returns (hard reset). Tell the compiler so this [[noreturn]]
  // handler doesn't trip -Werror=invalid-noreturn.
  __builtin_unreachable();
}

}  // extern "C"
