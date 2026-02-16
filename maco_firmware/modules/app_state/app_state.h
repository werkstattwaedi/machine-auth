// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <string_view>

#include "maco_firmware/modules/app_state/tag_verifier_observer.h"
#include "maco_firmware/modules/app_state/ui/snapshot.h"
#include "maco_firmware/types.h"
#include "pw_bytes/span.h"
#include "pw_string/string.h"
#include "pw_sync/lock_annotations.h"
#include "pw_sync/mutex.h"

namespace maco::app_state {

/// Thread-safe application state.
///
/// Implements TagVerifierObserver to receive verification state transitions.
/// State lives on the main thread, is updated via observer callbacks,
/// and can be safely read from the UI thread using the snapshot pattern.
class AppState : public TagVerifierObserver {
 public:
  /// Thread-safe read - fills snapshot under lock.
  /// Can be called from any thread (typically UI thread).
  void GetSnapshot(AppStateSnapshot& out) const PW_LOCKS_EXCLUDED(mutex_);

  // --- TagVerifierObserver overrides ---

  void OnTagDetected(pw::ConstByteSpan uid) override
      PW_LOCKS_EXCLUDED(mutex_);
  void OnVerifying() override PW_LOCKS_EXCLUDED(mutex_);
  void OnTagVerified(pw::ConstByteSpan ntag_uid) override
      PW_LOCKS_EXCLUDED(mutex_);
  void OnUnknownTag() override PW_LOCKS_EXCLUDED(mutex_);
  void OnAuthorizing() override PW_LOCKS_EXCLUDED(mutex_);
  void OnAuthorized(const maco::TagUid& tag_uid,
                    const maco::FirebaseId& user_id,
                    const pw::InlineString<64>& user_label,
                    const maco::FirebaseId& auth_id) override
      PW_LOCKS_EXCLUDED(mutex_);
  void OnUnauthorized() override PW_LOCKS_EXCLUDED(mutex_);
  void OnTagRemoved() override PW_LOCKS_EXCLUDED(mutex_);

 private:
  mutable pw::sync::Mutex mutex_;
  AppStateId state_ PW_GUARDED_BY(mutex_) = AppStateId::kIdle;
  TagUid tag_uid_ PW_GUARDED_BY(mutex_);
  TagUid ntag_uid_ PW_GUARDED_BY(mutex_);
  pw::InlineString<64> user_label_ PW_GUARDED_BY(mutex_);
  FirebaseId auth_id_ PW_GUARDED_BY(mutex_) = FirebaseId::Empty();
};

}  // namespace maco::app_state
