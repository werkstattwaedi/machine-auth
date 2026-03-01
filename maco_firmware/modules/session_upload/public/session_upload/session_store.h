// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include "maco_firmware/modules/app_state/session_fsm.h"
#include "pw_kvs/key_value_store.h"
#include "pw_result/result.h"
#include "pw_status/status.h"
#include "session_store.pb.h"

namespace maco::session_upload {

/// Persistent storage for active sessions and completed usage records.
///
/// Uses pw_kvs for flash-backed storage. All operations are synchronous
/// (blocking for flash write duration, typically <1ms for NOR flash).
///
/// Thread safety: Relies on pw_kvs internal locking. Safe to call from
/// the main dispatcher thread (observer callbacks).
class SessionStore {
 public:
  explicit SessionStore(pw::kvs::KeyValueStore& kvs);

  // --- Active session persistence ---

  /// Save a new active session to flash. Called on session start.
  /// @param utc_offset Seconds to add to boot-relative time for unix timestamp.
  ///                   Pass 0 if UTC offset is not yet known.
  pw::Status SaveActiveSession(const app_state::SessionInfo& session,
                               int64_t utc_offset);

  /// Update the heartbeat timestamp for the active session.
  pw::Status UpdateHeartbeat(int64_t utc_offset);

  /// Clear the active session from flash. Called on normal session end.
  pw::Status ClearActiveSession();

  /// Check if there is a persisted active session (from before a reset).
  bool HasOrphanedSession() const;

  /// Load the persisted active session info.
  /// Returns NOT_FOUND if none exists.
  pw::Result<app_state::SessionInfo> LoadOrphanedSession() const;

  /// Load the last_seen unix timestamp of the orphaned session.
  pw::Result<int64_t> LoadOrphanedLastSeenUnix() const;

  // --- Completed usage queue ---

  /// Append a completed usage record to the pending queue.
  /// @param utc_offset Seconds to add to boot-relative time for unix timestamp.
  ///                   Pass 0 if timestamps are already in unix seconds.
  pw::Status StoreCompletedUsage(const app_state::MachineUsage& usage,
                                 int64_t utc_offset);

  /// Get the count of pending usage records.
  size_t PendingUsageCount() const;

  /// Load all pending usage records.
  pw::Result<maco_session_upload_PendingUsageQueue> LoadPendingUsage() const;

  /// Clear all pending usage records (after successful upload).
  pw::Status ClearPendingUsage();

 private:
  static constexpr const char* kActiveKey = "active";
  static constexpr const char* kPendingKey = "pending";
  static constexpr size_t kMaxPendingRecords = 10;

  /// Convert a boot-relative time_point to unix seconds.
  static int64_t ToUnixSeconds(
      pw::chrono::SystemClock::time_point tp, int64_t utc_offset);

  pw::kvs::KeyValueStore& kvs_;
};

}  // namespace maco::session_upload
