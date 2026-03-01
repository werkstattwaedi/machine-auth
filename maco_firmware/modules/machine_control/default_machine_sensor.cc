// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#define PW_LOG_MODULE_NAME "DSEN"

#include "maco_firmware/modules/machine_control/default_machine_sensor.h"

#include "pw_log/log.h"

namespace maco::machine_control {

using namespace std::chrono_literals;

DefaultMachineSensor::DefaultMachineSensor(
    const MachineToggle& toggle,
    pw::async2::TimeProvider<pw::chrono::SystemClock>& time_provider,
    pw::allocator::Allocator& allocator)
    : toggle_(toggle), time_provider_(time_provider), coro_cx_(allocator) {}

void DefaultMachineSensor::Start(pw::async2::Dispatcher& dispatcher) {
  auto coro = Run(coro_cx_);
  task_.emplace(std::move(coro), [](pw::Status s) {
    PW_LOG_ERROR("DefaultMachineSensor failed: %d",
                 static_cast<int>(s.code()));
  });
  dispatcher.Post(*task_);
}

pw::async2::Coro<pw::Status> DefaultMachineSensor::Run(
    pw::async2::CoroContext& /*cx*/) {
  bool last = toggle_.IsEnabled();
  NotifyRunning(last);

  while (true) {
    co_await time_provider_.WaitFor(50ms);
    bool current = toggle_.IsEnabled();
    if (current != last) {
      last = current;
      NotifyRunning(current);
    }
  }
  co_return pw::OkStatus();
}

}  // namespace maco::machine_control
