// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#define PW_LOG_MODULE_NAME "SEVP"

#include "maco_firmware/modules/app_state/session_event_pump.h"

#include "pw_log/log.h"

namespace maco::app_state {

using namespace std::chrono_literals;

SessionEventPump::SessionEventPump(
    SessionFsm& fsm,
    pw::async2::TimeProvider<pw::chrono::SystemClock>& time_provider,
    pw::allocator::Allocator& allocator)
    : fsm_(fsm), time_provider_(time_provider), coro_cx_(allocator) {}

void SessionEventPump::Start(pw::async2::Dispatcher& dispatcher) {
  auto coro = Run(coro_cx_);
  task_.emplace(std::move(coro), [](pw::Status s) {
    PW_LOG_ERROR("SessionEventPump failed: %d", static_cast<int>(s.code()));
  });
  dispatcher.Post(*task_);
}

void SessionEventPump::PostUiAction(SessionAction action) {
  ui_action_.store(action, std::memory_order_relaxed);
}

pw::async2::Coro<pw::Status> SessionEventPump::Run(pw::async2::CoroContext&) {
  while (true) {
    // Poll UI action atomic and convert to FSM event
    auto action =
        ui_action_.exchange(SessionAction::kNone, std::memory_order_relaxed);
    if (action == SessionAction::kConfirm) {
      fsm_.receive(session_event::UiConfirm{});
      fsm_.SyncSnapshot();
    } else if (action == SessionAction::kCancel) {
      fsm_.receive(session_event::UiCancel{});
      fsm_.SyncSnapshot();
    }

    auto state_id = fsm_.get_state_id();
    bool is_pending =
        (state_id == SessionStateId::kCheckoutPending) ||
        (state_id == SessionStateId::kTakeoverPending);

    if (is_pending) {
      auto now = pw::chrono::SystemClock::now();

      // Check if tag held long enough for confirmation
      if (fsm_.tag_present()) {
        auto hold_duration = now - fsm_.tag_present_since();
        if (hold_duration >= kHoldDuration) {
          fsm_.receive(session_event::HoldConfirmed{});
          fsm_.SyncSnapshot();
        }
      }

      // Check deadline timeout
      if (now >= fsm_.pending_deadline) {
        fsm_.receive(session_event::Timeout{});
        fsm_.SyncSnapshot();
      }

      co_await time_provider_.WaitFor(100ms);
    } else {
      co_await time_provider_.WaitFor(500ms);
    }
  }
  // Unreachable -- loop runs until task is destroyed.
  co_return pw::OkStatus();
}

}  // namespace maco::app_state
