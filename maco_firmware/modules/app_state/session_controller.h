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

  /// Thread-safe: UI posts actions here.
  void PostUiAction(SessionAction action);

  /// Thread-safe combined snapshot for UI.
  void GetSnapshot(AppStateSnapshot& out) const;

 private:
  pw::async2::Coro<pw::Status> Run(pw::async2::CoroContext&);

  TagVerifier& tag_verifier_;
  SessionFsm& fsm_;
  pw::async2::TimeProvider<pw::chrono::SystemClock>& time_provider_;
  std::atomic<SessionAction> ui_action_{SessionAction::kNone};

  pw::async2::CoroContext coro_cx_;
  std::optional<pw::async2::CoroOrElseTask> task_;
};

}  // namespace maco::app_state
