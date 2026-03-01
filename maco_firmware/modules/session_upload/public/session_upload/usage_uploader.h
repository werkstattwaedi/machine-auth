// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

/// @file usage_uploader.h
/// @brief SessionObserver that persists sessions and uploads usage to Firebase.
///
/// Observes session lifecycle events to:
/// - Persist active sessions to flash (write-ahead for crash recovery)
/// - Update heartbeat timestamps periodically
/// - Queue completed usage records and upload them via FirebaseClient
/// - Retry uploads when gateway connectivity is available

#include <optional>

#include "device_config/device_config.h"
#include "firebase/firebase_client.h"
#include "maco_firmware/modules/app_state/session_fsm.h"
#include "maco_firmware/modules/app_state/system_state.h"
#include "pw_allocator/allocator.h"
#include "pw_async2/coro.h"
#include "pw_async2/coro_or_else_task.h"
#include "pw_async2/dispatcher.h"
#include "pw_async2/time_provider.h"
#include "pw_chrono/system_clock.h"
#include "session_upload/session_store.h"

namespace maco::session_upload {

/// Uploads completed machine usage records to Firebase Cloud Functions.
///
/// Lifecycle:
/// 1. Register as SessionObserver on SessionFsm
/// 2. Call Start() to begin the background coroutine
/// 3. OnSessionStarted -> persists session to flash (write-ahead)
/// 4. Background loop updates heartbeat every 5 minutes
/// 5. OnSessionEnded -> queues usage record, triggers upload
/// 6. TryUpload -> encodes and sends via FirebaseClient, retries on failure
class UsageUploader : public app_state::SessionObserver {
 public:
  UsageUploader(SessionStore& store,
                firebase::FirebaseClient& firebase,
                app_state::SystemState& system_state,
                const config::DeviceConfig& config,
                pw::async2::TimeProvider<pw::chrono::SystemClock>& time_provider,
                pw::allocator::Allocator& allocator);

  /// Start the background upload coroutine.
  void Start(pw::async2::Dispatcher& dispatcher);

  // SessionObserver overrides
  void OnSessionStarted(const app_state::SessionInfo& session) override;
  void OnSessionEnded(const app_state::SessionInfo& session,
                      const app_state::MachineUsage& usage) override;

 private:
  static constexpr auto kPollInterval = std::chrono::seconds(5);
  static constexpr auto kHeartbeatInterval = std::chrono::minutes(5);
  static constexpr auto kRetryInterval = std::chrono::seconds(60);

  /// Main coroutine loop: heartbeat updates, upload triggers, retries.
  pw::async2::Coro<pw::Status> Run(pw::async2::CoroContext& cx);

  /// Attempt to upload all pending usage records.
  pw::async2::Coro<pw::Status> TryUpload(pw::async2::CoroContext& cx);

  SessionStore& store_;
  firebase::FirebaseClient& firebase_;
  app_state::SystemState& system_state_;
  const config::DeviceConfig& config_;
  pw::async2::TimeProvider<pw::chrono::SystemClock>& time_provider_;

  pw::async2::CoroContext coro_cx_;
  std::optional<pw::async2::CoroOrElseTask> task_;

  bool session_active_ = false;
  bool upload_triggered_ = false;
  pw::chrono::SystemClock::time_point last_heartbeat_;
  pw::chrono::SystemClock::time_point last_upload_attempt_;
};

}  // namespace maco::session_upload
