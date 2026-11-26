// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <atomic>
#include <optional>

#include "async_util/status_coro_task.h"
#include "maco_firmware/modules/app_state/session_fsm.h"
#include "maco_firmware/modules/app_state/tag_verifier.h"
#include "maco_firmware/modules/app_state/ui/snapshot.h"
#include "pw_allocator/allocator.h"
#include "pw_async2/coro.h"
#include "pw_async2/dispatcher.h"
#include "pw_async2/time_provider.h"
#include "pw_chrono/system_clock.h"
#include "pw_function/function.h"

namespace maco::app_state {

/// Actions the UI can post to the session controller.
enum class SessionAction : uint8_t {
  kNone = 0,
  kConfirm = 1,
  kCancel = 2,
  kStop = 3,
  kConfirmReleased = 4,
};

/// Whether the machine counts as in use for the idle timer (ADR-0054).
enum class MachineActivity : uint8_t {
  kIdle = 0,
  kActive = 1,
  // Can't tell (device or gateway not answering) on a machine whose power the
  // terminal can't cut without the gateway: the idle timer pauses.
  kUnknown = 2,
};

/// Supplies the machine's live running state to the idle-timeout logic.
/// Implemented by MachineController (avoids an app_state → machine_control
/// dependency cycle).
class MachineRunningSource {
 public:
  virtual ~MachineRunningSource() = default;
  /// Billable use (e.g. laser cutting, spindle running).
  virtual bool IsMachineRunning() const = 0;
  /// In use for the idle timer. Defaults to billable use.
  virtual MachineActivity Activity() const {
    return IsMachineRunning() ? MachineActivity::kActive
                              : MachineActivity::kIdle;
  }
};

/// Single coordinator between TagVerifier, SessionFsm, and the UI.
///
/// Provides a combined GetSnapshot() that composes TagVerificationSnapshot
/// + SessionSnapshotUi into an AppStateSnapshot for the screen layer.
///
/// Also bridges timeouts, hold detection, and UI actions to SessionFsm events.
/// Runs as a coroutine on the main thread dispatcher.
class SessionController {
 public:
  SessionController(
      TagVerifier& tag_verifier,
      SessionFsm& fsm,
      pw::async2::TimeProvider<pw::chrono::SystemClock>& time_provider,
      pw::allocator::Allocator& allocator);

  void Start(pw::async2::Dispatcher& dispatcher);

  /// Enable idle auto-end for an activity-tracked machine (e.g. the laser).
  /// When the machine reports "not running" continuously for `idle_timeout`,
  /// the session ends with CheckoutReason::kTimeout; a warning is shown
  /// `idle_warning` before that. Not calling this (or a zero timeout) leaves
  /// the feature disabled — plain relay machines never idle-out.
  void SetIdleTimeout(const MachineRunningSource* machine,
                      pw::chrono::SystemClock::duration idle_timeout,
                      pw::chrono::SystemClock::duration idle_warning) {
    machine_ = machine;
    idle_timeout_ = idle_timeout;
    // The warning must open a window strictly inside the timeout; a
    // misconfigured warning >= timeout would otherwise fire the instant the
    // machine goes idle. Clamp to half the timeout.
    idle_warning_ = idle_warning < idle_timeout ? idle_warning
                                                : idle_timeout / 2;
  }

  /// Sound the buzzer when the idle warning opens and then every `repeat`
  /// while it stays open (ADR-0054). Zero keeps the warning silent.
  void SetIdleWarningBeep(pw::chrono::SystemClock::duration repeat,
                          pw::Function<void()> beep) {
    idle_warning_repeat_ = repeat;
    idle_warning_beep_ = std::move(beep);
  }

  /// Stopp needs OK held this long and is refused while the machine is in
  /// billable use (ADR-0054). Zero keeps the auto-confirm. Call before Start().
  void SetEndHold(pw::chrono::SystemClock::duration end_hold) {
    fsm_.end_hold = end_hold;
  }

  /// Thread-safe: end the session because the machine couldn't be switched
  /// on (the gateway-switched power didn't answer).
  void RequestMachineUnavailableEnd() {
    machine_unavailable_.store(true, std::memory_order_relaxed);
  }

  /// Thread-safe: UI posts actions here.
  void PostUiAction(SessionAction action);

  /// Thread-safe combined snapshot for UI.
  void GetSnapshot(AppStateSnapshot& out) const;

 private:
  pw::async2::Coro<pw::Status> Run(pw::async2::CoroContext );

  TagVerifier& tag_verifier_;
  SessionFsm& fsm_;
  pw::async2::TimeProvider<pw::chrono::SystemClock>& time_provider_;
  std::atomic<SessionAction> ui_action_{SessionAction::kNone};

  // Idle auto-end (main thread only). Disabled when machine_ is null or
  // idle_timeout_ is zero.
  const MachineRunningSource* machine_ = nullptr;
  pw::chrono::SystemClock::duration idle_timeout_{};
  pw::chrono::SystemClock::duration idle_warning_{};
  pw::chrono::SystemClock::time_point last_active_at_{};
  pw::chrono::SystemClock::time_point last_tick_{};

  pw::chrono::SystemClock::duration idle_warning_repeat_{};
  pw::Function<void()> idle_warning_beep_;
  std::optional<pw::chrono::SystemClock::time_point> next_beep_at_;

  std::atomic<bool> machine_unavailable_{false};
  std::atomic<bool> confirm_down_{false};

  pw::async2::CoroContext coro_cx_;
  std::optional<maco::async_util::StatusCoroTask> task_;
};

}  // namespace maco::app_state
