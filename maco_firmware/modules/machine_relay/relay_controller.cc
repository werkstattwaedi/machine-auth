// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#define PW_LOG_MODULE_NAME "RLYC"

#include "maco_firmware/modules/machine_relay/relay_controller.h"

#include "pw_log/log.h"

namespace maco::machine_relay {

using namespace std::chrono_literals;

RelayController::RelayController(
    MachineRelay& relay,
    pw::async2::TimeProvider<pw::chrono::SystemClock>& time_provider,
    pw::allocator::Allocator& allocator)
    : relay_(relay), time_provider_(time_provider), coro_cx_(allocator) {}

void RelayController::Start(pw::async2::Dispatcher& dispatcher) {
  auto coro = Run(coro_cx_);
  task_.emplace(std::move(coro), [](pw::Status s) {
    PW_LOG_ERROR("RelayController failed: %d", static_cast<int>(s.code()));
  });
  dispatcher.Post(*task_);
}

void RelayController::OnSessionStarted(const app_state::SessionInfo& session) {
  PW_LOG_INFO("Relay: enabling for %s", session.user_label.c_str());
  pending_command_.store(Command::kEnable, std::memory_order_relaxed);
}

void RelayController::OnSessionEnded(const app_state::SessionInfo&,
                                     const app_state::MachineUsage& usage) {
  PW_LOG_INFO("Relay: disabling (reason %d)",
              static_cast<int>(usage.reason));
  pending_command_.store(Command::kDisable, std::memory_order_relaxed);
}

pw::async2::Coro<pw::Status> RelayController::Run(
    pw::async2::CoroContext& cx) {
  while (true) {
    auto cmd =
        pending_command_.exchange(Command::kNone, std::memory_order_relaxed);

    if (cmd == Command::kEnable) {
      auto status = co_await relay_.Enable(cx);
      if (!status.ok()) {
        PW_LOG_ERROR("Relay.Enable() failed: %d",
                     static_cast<int>(status.code()));
      }
    } else if (cmd == Command::kDisable) {
      auto status = co_await relay_.Disable(cx);
      if (!status.ok()) {
        PW_LOG_ERROR("Relay.Disable() failed: %d",
                     static_cast<int>(status.code()));
      }
    }

    co_await time_provider_.WaitFor(50ms);
  }
  // Unreachable -- loop runs until task is destroyed.
  co_return pw::OkStatus();
}

}  // namespace maco::machine_relay
