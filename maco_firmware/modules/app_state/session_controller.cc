// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#define PW_LOG_MODULE_NAME "SCTL"

#include "maco_firmware/modules/app_state/session_controller.h"

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
  last_tick_ = last_active_at_;

  auto coro = Run(coro_cx_);
  task_.emplace(std::move(coro), [](pw::Status s) {
    PW_LOG_ERROR("SessionController failed: %d", static_cast<int>(s.code()));
  });
  dispatcher.Post(*task_);
}

void SessionController::PostUiAction(SessionAction action) {
  // The OK key's up/down state is kept apart from the one-slot action, so a
  // quick press-and-release within one tick can't swallow the press (or leave
  // a hold running after the key was let go).
  if (action == SessionAction::kConfirmReleased) {
    confirm_down_.store(false, std::memory_order_relaxed);
    return;
  }
  if (action == SessionAction::kConfirm) {
    confirm_down_.store(true, std::memory_order_relaxed);
  }
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
    const auto since_last_tick = now - last_tick_;
    last_tick_ = now;

    if (machine_unavailable_.exchange(false, std::memory_order_relaxed)) {
      fsm_.receive(session_event::MachineUnavailable{});
      fsm_.SyncSnapshot();
    }

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
      // A machine whose stop needs a hold refuses it while in billable use
      // (e.g. the spindle running): ending would cut its power mid-job.
      const bool refuse =
          fsm_.end_hold > pw::chrono::SystemClock::duration::zero() &&
          machine_ != nullptr && machine_->IsMachineRunning();
      fsm_.receive(session_event::StopSession(refuse));
      fsm_.SyncSnapshot();
    }
    if (fsm_.stop_hold_active &&
        !confirm_down_.load(std::memory_order_relaxed)) {
      fsm_.receive(session_event::UiConfirmReleased{});
      fsm_.SyncSnapshot();
    }

    auto state_id = fsm_.get_state_id();

    // --- Idle auto-end (activity-tracked machines only) ---
    bool idle_enabled = machine_ != nullptr &&
                        idle_timeout_ > pw::chrono::SystemClock::duration::zero();
    if (idle_enabled) {
      bool in_running = state_id == SessionStateId::kRunning;
      bool in_warning = state_id == SessionStateId::kIdleWarning;
      const MachineActivity activity = machine_->Activity();
      // Keep the idle reference fresh while there's no active session, and
      // reset it on any machine activity — so idle always counts from the
      // last time the machine was actually in use.
      if ((!in_running && !in_warning) ||
          activity == MachineActivity::kActive) {
        last_active_at_ = now;
      } else if (activity == MachineActivity::kUnknown) {
        // Pause: the terminal couldn't switch the machine off anyway, and a
        // Wi-Fi blip must not end a job. Shift the reference by the time we
        // couldn't see, so counting resumes where it stopped.
        last_active_at_ += since_last_tick;
        if (in_warning) {
          fsm_.pending_deadline += since_last_tick;
          fsm_.pending_since += since_last_tick;
          fsm_.SyncSnapshot();
        }
      }
      if (in_running && (now - last_active_at_) >= idle_timeout_ - idle_warning_) {
        // Enter the warning; deadline is the actual auto-end instant.
        fsm_.pending_since = now;
        fsm_.pending_deadline = last_active_at_ + idle_timeout_;
        fsm_.receive(session_event::IdleWarn{});
        fsm_.SyncSnapshot();
        state_id = fsm_.get_state_id();
      } else if (in_warning && activity == MachineActivity::kActive) {
        // Machine resumed during the warning → snooze back to running.
        fsm_.receive(session_event::UiConfirm{});
        fsm_.SyncSnapshot();
        state_id = fsm_.get_state_id();
      }
    }

    // Idle-warning beep: on entry, then every repeat interval while open.
    if (state_id == SessionStateId::kIdleWarning &&
        idle_warning_repeat_ > pw::chrono::SystemClock::duration::zero() &&
        idle_warning_beep_) {
      if (!next_beep_at_.has_value() || now >= *next_beep_at_) {
        idle_warning_beep_();
        next_beep_at_ = now + idle_warning_repeat_;
      }
    } else {
      next_beep_at_.reset();
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
        if (HoldSatisfied(now, fsm_.tag_present_since(), fsm_.pending_since)) {
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
