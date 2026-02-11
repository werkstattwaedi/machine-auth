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
/// State lives on the main thread, is updated via events from TagVerifier,
/// and can be safely read from the UI thread using the snapshot pattern.
class AppState {
 public:
  /// Thread-safe read - fills snapshot under lock.
  /// Can be called from any thread (typically UI thread).
  void GetSnapshot(AppStateSnapshot& out) const PW_LOCKS_EXCLUDED(mutex_);

  /// Tag detected at RF layer - transitions to kTagDetected.
  void OnTagDetected(pw::ConstByteSpan uid) PW_LOCKS_EXCLUDED(mutex_);

  /// Verification in progress - transitions to kVerifying.
  void OnVerifying() PW_LOCKS_EXCLUDED(mutex_);

  /// Tag verified as genuine OWW tag - transitions to kGenuine.
  void OnTagVerified(pw::ConstByteSpan ntag_uid) PW_LOCKS_EXCLUDED(mutex_);

  /// Tag is not a recognized OWW tag - transitions to kUnknownTag.
  void OnUnknownTag() PW_LOCKS_EXCLUDED(mutex_);

  /// Tag removed from field - transitions to kIdle.
  void OnTagRemoved() PW_LOCKS_EXCLUDED(mutex_);

 private:
  mutable pw::sync::Mutex mutex_;
  AppStateId state_ PW_GUARDED_BY(mutex_) = AppStateId::kIdle;
  TagUid tag_uid_ PW_GUARDED_BY(mutex_);
  TagUid ntag_uid_ PW_GUARDED_BY(mutex_);
};

}  // namespace maco::app_state
