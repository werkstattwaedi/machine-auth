// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#define PW_LOG_MODULE_NAME "relay"

#include "maco_firmware/modules/machine_relay/latching_machine_relay.h"

#include "gpio_hal.h"
#include "pw_log/log.h"

namespace maco::machine_relay {

using namespace std::chrono_literals;

LatchingMachineRelay::LatchingMachineRelay(
    hal_pin_t pin,
    pw::async2::TimeProvider<pw::chrono::SystemClock>& time_provider)
    : pin_(pin), time_provider_(time_provider) {}

pw::Status LatchingMachineRelay::Init() {
  // Configure GPIO as input to read current state
  hal_gpio_mode(pin_, INPUT);
  enabled_ = hal_gpio_read(pin_) != 0;
  initialized_ = true;
  PW_LOG_DEBUG("Relay initialized, state: %s",
               enabled_ ? "enabled" : "disabled");
  return pw::OkStatus();
}

bool LatchingMachineRelay::IsEnabled() const { return enabled_; }

pw::async2::Coro<pw::Status> LatchingMachineRelay::Enable(
    pw::async2::CoroContext& cx) {
  if (!initialized_) {
    PW_LOG_ERROR("Machine relay not initialized");
    co_return pw::Status::FailedPrecondition();
  }

  if (enabled_) {
    co_return pw::OkStatus();
  }

  co_return co_await DoSetState(cx, true);
}

pw::async2::Coro<pw::Status> LatchingMachineRelay::Disable(
    pw::async2::CoroContext& cx) {
  if (!initialized_) {
    PW_LOG_ERROR("Machine relay not initialized");
    co_return pw::Status::FailedPrecondition();
  }

  if (!enabled_) {
    co_return pw::OkStatus();
  }

  co_return co_await DoSetState(cx, false);
}

pw::async2::Coro<pw::Status> LatchingMachineRelay::DoSetState(
    [[maybe_unused]] pw::async2::CoroContext& cx, bool enable) {
  PW_LOG_DEBUG("Machine relay toggling to %s", enable ? "enable" : "disable");

  // Write output state (switches GPIO to OUTPUT mode)
  hal_gpio_mode(pin_, OUTPUT);
  hal_gpio_write(pin_, enable ? 1 : 0);

  // Async wait for relay to latch - yields to cooperative scheduler
  co_await time_provider_.WaitFor(kPulseDuration);

  // Read and verify state (switches GPIO back to INPUT mode)
  hal_gpio_mode(pin_, INPUT);
  bool actual = hal_gpio_read(pin_) != 0;

  if (actual != enable) {
    PW_LOG_ERROR(
        "Machine relay toggle verification failed: expected %d, got %d", enable,
        actual);
    co_return pw::Status::Internal();
  }

  enabled_ = enable;
  if (enable) {
    PW_LOG_INFO("Machine power ON");
  } else {
    PW_LOG_DEBUG("Machine power off");
  }
  co_return pw::OkStatus();
}

}  // namespace maco::machine_relay
