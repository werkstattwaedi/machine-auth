// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <atomic>
#include <optional>

#include "maco_firmware/modules/app_state/session_fsm.h"
#include "maco_firmware/modules/machine_control/machine_toggle.h"
#include "pw_allocator/allocator.h"
#include "pw_async2/coro.h"
#include "pw_async2/coro_or_else_task.h"
#include "pw_async2/dispatcher.h"
#include "pw_async2/time_provider.h"
#include "pw_chrono/system_clock.h"

namespace maco::machine_control {

/// Drives the machine toggle based on session state.
///
/// Implements SessionObserver: enables toggle on session start,
/// disables on session end. Runs as a long-lived polling coroutine
/// that processes toggle commands asynchronously, avoiding task
/// lifetime issues from replacing in-flight coroutines.
class MachineController : public app_state::SessionObserver {
 public:
  MachineController(
      MachineToggle& toggle,
      pw::async2::TimeProvider<pw::chrono::SystemClock>& time_provider,
      pw::allocator::Allocator& allocator);

  void Start(pw::async2::Dispatcher& dispatcher);

  /// Returns true if the toggle is currently enabled.
  bool IsToggleEnabled() const { return toggle_.IsEnabled(); }

  /// Returns true if the sensor reports the machine is running.
  bool IsMachineRunning() const {
    return machine_running_.load(std::memory_order_relaxed);
  }

  /// Called by MachineSensor when the running state changes.
  void OnMachineRunning(bool running);

  void OnSessionStarted(const app_state::SessionInfo& session) override;
  void OnSessionEnded(const app_state::SessionInfo& session,
                      const app_state::MachineUsage& usage) override;

 private:
  enum class Command : uint8_t { kNone, kEnable, kDisable };

  pw::async2::Coro<pw::Status> Run(pw::async2::CoroContext&);

  MachineToggle& toggle_;
  pw::async2::TimeProvider<pw::chrono::SystemClock>& time_provider_;
  std::atomic<Command> pending_command_{Command::kNone};
  std::atomic<bool> machine_running_{false};

  pw::async2::CoroContext coro_cx_;
  std::optional<pw::async2::CoroOrElseTask> task_;
};

}  // namespace maco::machine_control
