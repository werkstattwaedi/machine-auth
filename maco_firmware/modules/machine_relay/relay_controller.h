// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <atomic>
#include <optional>

#include "maco_firmware/modules/app_state/session_fsm.h"
#include "maco_firmware/modules/machine_relay/machine_relay.h"
#include "pw_allocator/allocator.h"
#include "pw_async2/coro.h"
#include "pw_async2/coro_or_else_task.h"
#include "pw_async2/dispatcher.h"
#include "pw_async2/time_provider.h"
#include "pw_chrono/system_clock.h"

namespace maco::machine_relay {

/// Drives the machine relay based on session state.
///
/// Implements SessionObserver: enables relay on session start,
/// disables on session end. Runs as a long-lived polling coroutine
/// that processes relay commands asynchronously, avoiding task
/// lifetime issues from replacing in-flight coroutines.
class RelayController : public app_state::SessionObserver {
 public:
  RelayController(
      MachineRelay& relay,
      pw::async2::TimeProvider<pw::chrono::SystemClock>& time_provider,
      pw::allocator::Allocator& allocator);

  void Start(pw::async2::Dispatcher& dispatcher);

  void OnSessionStarted(const app_state::SessionInfo& session) override;
  void OnSessionEnded(const app_state::SessionInfo& session,
                      const app_state::MachineUsage& usage) override;

 private:
  enum class Command : uint8_t { kNone, kEnable, kDisable };

  pw::async2::Coro<pw::Status> Run(pw::async2::CoroContext&);

  MachineRelay& relay_;
  pw::async2::TimeProvider<pw::chrono::SystemClock>& time_provider_;
  std::atomic<Command> pending_command_{Command::kNone};

  pw::async2::CoroContext coro_cx_;
  std::optional<pw::async2::CoroOrElseTask> task_;
};

}  // namespace maco::machine_relay
