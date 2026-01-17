// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/modules/app_state/app_state.h"

#include <algorithm>
#include <mutex>

#include "pw_assert/check.h"
#include "pw_sync/lock_annotations.h"

namespace maco::app_state {

void AppState::GetSnapshot(AppStateSnapshot& out) const {
  std::lock_guard lock(mutex_);
  out.state = state_;
  out.tag_uid = tag_uid_;
}

void AppState::OnTagDetected(pw::ConstByteSpan uid) {
  PW_CHECK(uid.size() <= kMaxTagUidSize, "Tag UID too large");

  std::lock_guard lock(mutex_);
  state_ = AppStateId::kHasTag;
  tag_uid_.size = uid.size();
  std::copy(uid.begin(), uid.end(), tag_uid_.bytes.begin());
}

void AppState::OnTagRemoved() {
  std::lock_guard lock(mutex_);
  state_ = AppStateId::kNoTag;
  tag_uid_.size = 0;
}

}  // namespace maco::app_state
