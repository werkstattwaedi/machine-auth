// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "pb_watchdog/watchdog.h"

#include "watchdog_hal.h"

namespace pb::watchdog {

Watchdog::~Watchdog() {
  if (enabled_) {
    // Ignore return value in destructor - best effort cleanup
    (void)Disable();
  }
}

pw::Status Watchdog::Enable(pw::chrono::SystemClock::duration timeout) {
  // Convert to milliseconds
  auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(timeout);
  return Enable(static_cast<uint32_t>(ms.count()));
}

pw::Status Watchdog::Enable(uint32_t timeout_ms) {
  hal_watchdog_config_t config = {};
  config.size = sizeof(hal_watchdog_config_t);
  config.version = HAL_WATCHDOG_VERSION;
  config.timeout_ms = timeout_ms;
  config.enable_caps = HAL_WATCHDOG_CAPS_RESET;

  int result = hal_watchdog_set_config(HAL_WATCHDOG_INSTANCE1, &config, nullptr);
  if (result != 0) {
    return pw::Status::Internal();
  }

  result = hal_watchdog_start(HAL_WATCHDOG_INSTANCE1, nullptr);
  if (result != 0) {
    return pw::Status::Internal();
  }

  enabled_ = true;
  timeout_ms_ = timeout_ms;
  return pw::OkStatus();
}

pw::Status Watchdog::Disable() {
  int result = hal_watchdog_stop(HAL_WATCHDOG_INSTANCE1, nullptr);
  if (result != 0) {
    // Some watchdogs can't be stopped once started
    return pw::Status::FailedPrecondition();
  }

  enabled_ = false;
  return pw::OkStatus();
}

pw::Status Watchdog::Feed() {
  if (!enabled_) {
    return pw::Status::FailedPrecondition();
  }

  int result = hal_watchdog_refresh(HAL_WATCHDOG_INSTANCE1, nullptr);
  if (result != 0) {
    return pw::Status::Internal();
  }

  return pw::OkStatus();
}

pw::Status Watchdog::SetExpiredCallback(ExpiredCallback callback, void* context) {
  int result = hal_watchdog_on_expired_callback(
      HAL_WATCHDOG_INSTANCE1,
      reinterpret_cast<hal_watchdog_on_expired_callback_t>(callback),
      context,
      nullptr);
  if (result != 0) {
    return pw::Status::Internal();
  }

  return pw::OkStatus();
}

}  // namespace pb::watchdog
