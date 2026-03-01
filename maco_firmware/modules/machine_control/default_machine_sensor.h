// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <optional>

#include "maco_firmware/modules/machine_control/machine_sensor.h"
#include "maco_firmware/modules/machine_control/machine_toggle.h"
#include "pw_allocator/allocator.h"
#include "pw_async2/coro.h"
#include "pw_async2/coro_or_else_task.h"
#include "pw_async2/time_provider.h"
#include "pw_chrono/system_clock.h"

namespace maco::machine_control {

/// Default sensor that mirrors the toggle state.
///
/// When no dedicated sensor hardware is available, the machine is
/// considered "running" whenever the toggle is enabled. Polls toggle
/// state at 50ms and notifies on change.
class DefaultMachineSensor : public MachineSensor {
 public:
  DefaultMachineSensor(
      const MachineToggle& toggle,
      pw::async2::TimeProvider<pw::chrono::SystemClock>& time_provider,
      pw::allocator::Allocator& allocator);

  void Start(pw::async2::Dispatcher& dispatcher) override;

 private:
  pw::async2::Coro<pw::Status> Run(pw::async2::CoroContext& cx);

  const MachineToggle& toggle_;
  pw::async2::TimeProvider<pw::chrono::SystemClock>& time_provider_;
  pw::async2::CoroContext coro_cx_;
  std::optional<pw::async2::CoroOrElseTask> task_;
};

}  // namespace maco::machine_control
