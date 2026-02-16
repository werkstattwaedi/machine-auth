// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <atomic>
#include <optional>

#include "maco_firmware/modules/app_state/session_fsm.h"
#include "pw_allocator/allocator.h"
#include "pw_async2/coro.h"
#include "pw_async2/coro_or_else_task.h"
#include "pw_async2/dispatcher.h"
#include "pw_async2/time_provider.h"
#include "pw_chrono/system_clock.h"

namespace maco::app_state {

/// Actions the UI can post to the session event pump.
enum class SessionAction : uint8_t {
  kNone = 0,
  kConfirm = 1,
  kCancel = 2,
};

/// Bridges timeouts, hold detection, and UI actions to SessionFsm events.
///
/// Runs as a coroutine on the main thread dispatcher. Polls at different
/// rates depending on FSM state:
/// - Pending states: 100ms (responsive hold detection)
/// - Running/NoSession: 500ms (low overhead)
///
/// UI thread posts actions via atomic flag; the pump converts them
/// to FSM receive() calls on the main thread.
class SessionEventPump {
 public:
  SessionEventPump(
      SessionFsm& fsm,
      pw::async2::TimeProvider<pw::chrono::SystemClock>& time_provider,
      pw::allocator::Allocator& allocator);

  void Start(pw::async2::Dispatcher& dispatcher);

  /// Thread-safe: UI posts actions here.
  void PostUiAction(SessionAction action);

 private:
  pw::async2::Coro<pw::Status> Run(pw::async2::CoroContext&);

  SessionFsm& fsm_;
  pw::async2::TimeProvider<pw::chrono::SystemClock>& time_provider_;
  std::atomic<SessionAction> ui_action_{SessionAction::kNone};

  pw::async2::CoroContext coro_cx_;
  std::optional<pw::async2::CoroOrElseTask> task_;
};

}  // namespace maco::app_state
