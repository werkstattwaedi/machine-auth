// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <string_view>

#include "maco_firmware/modules/app_state/ui/snapshot.h"
#include "maco_firmware/types.h"
#include "pw_bytes/span.h"
#include "pw_string/string.h"
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

  /// Cloud authorization in progress - transitions to kAuthorizing.
  void OnAuthorizing() PW_LOCKS_EXCLUDED(mutex_);

  /// Cloud authorized the user - transitions to kAuthorized.
  void OnAuthorized(std::string_view user_label,
                    const FirebaseId& auth_id) PW_LOCKS_EXCLUDED(mutex_);

  /// Cloud rejected the user - transitions to kUnauthorized.
  void OnUnauthorized() PW_LOCKS_EXCLUDED(mutex_);

  /// Tag removed from field - transitions to kIdle.
  void OnTagRemoved() PW_LOCKS_EXCLUDED(mutex_);

 private:
  mutable pw::sync::Mutex mutex_;
  AppStateId state_ PW_GUARDED_BY(mutex_) = AppStateId::kIdle;
  TagUid tag_uid_ PW_GUARDED_BY(mutex_);
  TagUid ntag_uid_ PW_GUARDED_BY(mutex_);
  pw::InlineString<64> user_label_ PW_GUARDED_BY(mutex_);
  FirebaseId auth_id_ PW_GUARDED_BY(mutex_) = FirebaseId::Empty();
};

}  // namespace maco::app_state
