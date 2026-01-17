// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include "maco_firmware/modules/app_state/ui/snapshot.h"
#include "pw_bytes/span.h"
#include "pw_sync/lock_annotations.h"
#include "pw_sync/mutex.h"

namespace maco::app_state {

/// Thread-safe application state.
///
/// State lives on the main thread, is updated via events from NfcReader,
/// and can be safely read from the UI thread using the snapshot pattern.
///
/// Usage:
///   // Main thread (NfcReader task):
///   app_state.OnTagDetected(uid);
///
///   // UI thread (AppShell::Update):
///   AppStateSnapshot snapshot;
///   app_state.GetSnapshot(snapshot);
class AppState {
 public:
  /// Thread-safe read - fills snapshot under lock.
  /// Can be called from any thread (typically UI thread).
  void GetSnapshot(AppStateSnapshot& out) const PW_LOCKS_EXCLUDED(mutex_);

  /// Tag detected - transitions to kHasTag state.
  /// Called from main thread (NfcReader task).
  void OnTagDetected(pw::ConstByteSpan uid) PW_LOCKS_EXCLUDED(mutex_);

  /// Tag removed - transitions to kNoTag state.
  /// Called from main thread (NfcReader task).
  void OnTagRemoved() PW_LOCKS_EXCLUDED(mutex_);

 private:
  mutable pw::sync::Mutex mutex_;
  AppStateId state_ PW_GUARDED_BY(mutex_) = AppStateId::kNoTag;
  TagUid tag_uid_ PW_GUARDED_BY(mutex_);
};

}  // namespace maco::app_state
