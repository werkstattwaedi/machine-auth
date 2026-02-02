// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <chrono>

#include "maco_firmware/modules/machine_relay/machine_relay.h"
#include "pinmap_hal.h"
#include "pw_async2/coro.h"
#include "pw_async2/system_time_provider.h"
#include "pw_status/status.h"

namespace maco::machine_relay {

/// Latching relay implementation for P2 hardware.
///
/// The latching relay requires a specific GPIO sequence to toggle:
/// 1. Normal state: GPIO configured as INPUT (to read current relay state)
/// 2. To toggle: OUTPUT mode -> write value -> wait 50ms -> INPUT mode -> verify
///
/// Uses async wait via coroutines to avoid blocking the cooperative scheduler.
class LatchingMachineRelay : public MachineRelay {
 public:
  static constexpr std::chrono::milliseconds kPulseDuration{50};

  /// Construct a latching relay controller.
  /// @param pin The HAL pin connected to the relay
  /// @param time_provider Time provider for async delays
  LatchingMachineRelay(
      hal_pin_t pin,
      pw::async2::TimeProvider<pw::chrono::SystemClock>& time_provider);

  pw::Status Init() override;
  bool IsEnabled() const override;
  pw::async2::Coro<pw::Status> Enable(pw::async2::CoroContext& cx) override;
  pw::async2::Coro<pw::Status> Disable(pw::async2::CoroContext& cx) override;

 private:
  /// Coroutine that performs the toggle sequence.
  pw::async2::Coro<pw::Status> DoSetState(pw::async2::CoroContext& cx,
                                          bool enable);

  hal_pin_t pin_;
  pw::async2::TimeProvider<pw::chrono::SystemClock>& time_provider_;
  bool enabled_ = false;
  bool initialized_ = false;
};

}  // namespace maco::machine_relay
