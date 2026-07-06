// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#define PW_LOG_MODULE_NAME "MCTL"

#include "maco_firmware/modules/machine_control/machine_controller.h"

#include <mutex>

#include "pw_log/log.h"

namespace maco::machine_control {

using namespace std::chrono_literals;

MachineController::MachineController(
    MachineToggle& toggle,
    pw::async2::TimeProvider<pw::chrono::SystemClock>& time_provider,
    pw::allocator::Allocator& allocator)
    : toggle_(toggle),
      time_provider_(time_provider),
      coro_cx_(allocator) {}

void MachineController::Start(pw::async2::Dispatcher& dispatcher) {
  auto coro = Run(coro_cx_);
  task_.emplace(std::move(coro), [](pw::Status s) {
    PW_LOG_ERROR("MachineController failed: %d", static_cast<int>(s.code()));
  });
  dispatcher.Post(*task_);
}

void MachineController::OnSessionStarted(
    const app_state::SessionInfo& session) {
  PW_LOG_INFO("Toggle: enabling for %s", session.user_label.c_str());
  pending_command_.store(Command::kEnable, std::memory_order_relaxed);

  // Reset the in-use accumulator for the new session. Seed the running
  // interval if the machine is somehow already reporting running.
  std::lock_guard lock(accumulator_mutex_);
  accumulated_in_use_ = pw::chrono::SystemClock::duration::zero();
  running_since_ = IsMachineRunning()
                       ? std::optional(time_provider_.now())
                       : std::nullopt;
}

void MachineController::OnSessionEnded(const app_state::SessionInfo&,
                                       const app_state::MachineUsage& usage) {
  PW_LOG_INFO("Toggle: disabling (reason %d)",
              static_cast<int>(usage.reason));
  pending_command_.store(Command::kDisable, std::memory_order_relaxed);

  // Close out any open running interval so a later read is well-defined.
  std::lock_guard lock(accumulator_mutex_);
  if (running_since_.has_value()) {
    accumulated_in_use_ += time_provider_.now() - *running_since_;
    running_since_ = std::nullopt;
  }
}

void MachineController::OnMachineRunning(bool running) {
  bool was = machine_running_.exchange(running, std::memory_order_relaxed);
  if (running == was) {
    return;
  }
  PW_LOG_INFO("Machine %s", running ? "running" : "stopped");

  auto now = time_provider_.now();
  std::lock_guard lock(accumulator_mutex_);
  if (running) {
    running_since_ = now;
  } else if (running_since_.has_value()) {
    accumulated_in_use_ += now - *running_since_;
    running_since_ = std::nullopt;
  }
}

pw::chrono::SystemClock::duration MachineController::BillableElapsed() const {
  std::lock_guard lock(accumulator_mutex_);
  auto total = accumulated_in_use_;
  if (running_since_.has_value()) {
    total += time_provider_.now() - *running_since_;
  }
  return total;
}

pw::async2::Coro<pw::Status> MachineController::Run(
    pw::async2::CoroContext cx) {
  while (true) {
    auto cmd =
        pending_command_.exchange(Command::kNone, std::memory_order_relaxed);

    if (cmd == Command::kEnable) {
      auto status = co_await toggle_.Enable(cx);
      if (!status.ok()) {
        PW_LOG_ERROR("Toggle.Enable() failed: %d",
                     static_cast<int>(status.code()));
      }
    } else if (cmd == Command::kDisable) {
      auto status = co_await toggle_.Disable(cx);
      if (!status.ok()) {
        PW_LOG_ERROR("Toggle.Disable() failed: %d",
                     static_cast<int>(status.code()));
      }
    }

    co_await time_provider_.WaitFor(50ms);
  }
  // Unreachable -- loop runs until task is destroyed.
  co_return pw::OkStatus();
}

}  // namespace maco::machine_control
