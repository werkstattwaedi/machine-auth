// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <atomic>
#include <optional>

#include "maco_firmware/modules/app_state/session_fsm.h"
#include "maco_firmware/modules/app_state/tag_verifier.h"
#include "maco_firmware/modules/app_state/ui/snapshot.h"
#include "pw_allocator/allocator.h"
#include "pw_async2/coro.h"
#include "pw_async2/coro_or_else_task.h"
#include "pw_async2/dispatcher.h"
#include "pw_async2/time_provider.h"
#include "pw_chrono/system_clock.h"

namespace maco::app_state {

/// Actions the UI can post to the session controller.
enum class SessionAction : uint8_t {
  kNone = 0,
  kConfirm = 1,
  kCancel = 2,
  kStop = 3,
};

/// Supplies the machine's live running state to the idle-timeout logic.
/// Implemented by MachineController (avoids an app_state → machine_control
/// dependency cycle).
class MachineRunningSource {
 public:
  virtual ~MachineRunningSource() = default;
  virtual bool IsMachineRunning() const = 0;
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

  pw::async2::CoroContext coro_cx_;
  std::optional<pw::async2::CoroOrElseTask> task_;
};

}  // namespace maco::app_state
