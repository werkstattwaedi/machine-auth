// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/modules/app_state/app_state.h"

#include <algorithm>
#include <mutex>

#include "pw_assert/check.h"

namespace maco::app_state {

void AppState::GetSnapshot(AppStateSnapshot& out) const {
  std::lock_guard lock(mutex_);
  out.state = state_;
  out.tag_uid = tag_uid_;
  out.ntag_uid = ntag_uid_;
}

void AppState::OnTagDetected(pw::ConstByteSpan uid) {
  PW_CHECK(uid.size() <= kMaxTagUidSize, "Tag UID too large");

  std::lock_guard lock(mutex_);
  state_ = AppStateId::kTagDetected;
  tag_uid_.size = uid.size();
  std::copy(uid.begin(), uid.end(), tag_uid_.bytes.begin());
  ntag_uid_ = {};
}

void AppState::OnVerifying() {
  std::lock_guard lock(mutex_);
  state_ = AppStateId::kVerifying;
}

void AppState::OnTagVerified(pw::ConstByteSpan ntag_uid) {
  PW_CHECK(ntag_uid.size() <= kMaxTagUidSize, "NTAG UID too large");

  std::lock_guard lock(mutex_);
  state_ = AppStateId::kGenuine;
  ntag_uid_.size = ntag_uid.size();
  std::copy(ntag_uid.begin(), ntag_uid.end(), ntag_uid_.bytes.begin());
}

void AppState::OnUnknownTag() {
  std::lock_guard lock(mutex_);
  state_ = AppStateId::kUnknownTag;
}

void AppState::OnTagRemoved() {
  std::lock_guard lock(mutex_);
  state_ = AppStateId::kIdle;
  tag_uid_ = {};
  ntag_uid_ = {};
}

}  // namespace maco::app_state
