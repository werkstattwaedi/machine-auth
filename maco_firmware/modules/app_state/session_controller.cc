// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#define PW_LOG_MODULE_NAME "SCTL"

#include "maco_firmware/modules/app_state/session_controller.h"

#include <algorithm>

#include "pw_log/log.h"

namespace maco::app_state {

using namespace std::chrono_literals;

SessionController::SessionController(
    TagVerifier& tag_verifier,
    SessionFsm& fsm,
    pw::async2::TimeProvider<pw::chrono::SystemClock>& time_provider,
    pw::allocator::Allocator& allocator)
    : tag_verifier_(tag_verifier),
      fsm_(fsm),
      time_provider_(time_provider),
      coro_cx_(allocator) {}

void SessionController::Start(pw::async2::Dispatcher& dispatcher) {
  // Seed the idle reference to now. A session recovered from flash
  // (RecoverOrphanedSession) is already in kRunning before we start, so
  // without this the epoch-default would make the first tick treat it as
  // idle-for-uptime and auto-end it immediately.
  last_active_at_ = pw::chrono::SystemClock::now();

  auto coro = Run(coro_cx_);
  task_.emplace(std::move(coro), [](pw::Status s) {
    PW_LOG_ERROR("SessionController failed: %d", static_cast<int>(s.code()));
  });
  dispatcher.Post(*task_);
}

void SessionController::PostUiAction(SessionAction action) {
  ui_action_.store(action, std::memory_order_relaxed);
}

void SessionController::GetSnapshot(AppStateSnapshot& out) const {
  tag_verifier_.GetSnapshot(out.verification);
  fsm_.GetSnapshot(out.session);
}

pw::async2::Coro<pw::Status> SessionController::Run(
    pw::async2::CoroContext ) {
  while (true) {
    auto now = pw::chrono::SystemClock::now();

    // Poll UI action atomic and convert to FSM event
    auto action =
        ui_action_.exchange(SessionAction::kNone, std::memory_order_relaxed);
    if (action == SessionAction::kConfirm) {
      // Confirm doubles as the idle-warning "Weiter" (snooze): reset the idle
      // reference so the machine gets another full timeout window.
      last_active_at_ = now;
      fsm_.receive(session_event::UiConfirm{});
      fsm_.SyncSnapshot();
    } else if (action == SessionAction::kCancel) {
      fsm_.receive(session_event::UiCancel{});
      fsm_.SyncSnapshot();
    } else if (action == SessionAction::kStop) {
      fsm_.receive(session_event::StopSession{});
      fsm_.SyncSnapshot();
    }

    auto state_id = fsm_.get_state_id();

    // --- Idle auto-end (activity-tracked machines only) ---
    bool idle_enabled = machine_ != nullptr &&
                        idle_timeout_ > pw::chrono::SystemClock::duration::zero();
    if (idle_enabled) {
      bool in_running = state_id == SessionStateId::kRunning;
      bool in_warning = state_id == SessionStateId::kIdleWarning;
      // Keep the idle reference fresh while there's no active session, and
      // reset it on any machine activity — so idle always counts from the
      // last time the machine was actually in use.
      if ((!in_running && !in_warning) || machine_->IsMachineRunning()) {
        last_active_at_ = now;
      }
      if (in_running && (now - last_active_at_) >= idle_timeout_ - idle_warning_) {
        // Enter the warning; deadline is the actual auto-end instant.
        fsm_.pending_since = now;
        fsm_.pending_deadline = last_active_at_ + idle_timeout_;
        fsm_.receive(session_event::IdleWarn{});
        fsm_.SyncSnapshot();
        state_id = fsm_.get_state_id();
      } else if (in_warning && machine_->IsMachineRunning()) {
        // Machine resumed during the warning → snooze back to running.
        fsm_.receive(session_event::UiConfirm{});
        fsm_.SyncSnapshot();
        state_id = fsm_.get_state_id();
      }
    }

    bool is_pending =
        (state_id == SessionStateId::kCheckoutPending) ||
        (state_id == SessionStateId::kTakeoverPending) ||
        (state_id == SessionStateId::kStopPending) ||
        (state_id == SessionStateId::kIdleWarning);

    if (is_pending) {
      // Check if tag held long enough for confirmation (not for stop/idle).
      if (state_id != SessionStateId::kStopPending &&
          state_id != SessionStateId::kIdleWarning && fsm_.tag_present()) {
        // Measure the hold from when the confirm prompt appeared
        // (pending_since), not from physical tag arrival. Entry into
        // Checkout/TakeoverPending happens only after NTAG mutual auth + a
        // cloud TerminalCheckin, commonly >3 s — and a takeover (a different
        // user, least likely to be cached) is exactly the slow case. So
        // tag_present_since_ is already older than kHoldDuration at prompt
        // entry, and the very next ~100 ms poll would fire HoldConfirmed
        // instantly, giving no chance to cancel and defeating the takeover
        // safety gate. Taking the later of the two also enforces a fresh
        // hold if the tag was removed and re-presented after the prompt.
        auto hold_reference =
            std::max(fsm_.tag_present_since(), fsm_.pending_since);
        auto hold_duration = now - hold_reference;
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
