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
  out.user_label = user_label_;
  out.auth_id = auth_id_;
}

void AppState::OnTagDetected(pw::ConstByteSpan uid) {
  PW_CHECK(uid.size() <= kMaxTagUidSize, "Tag UID too large");

  std::lock_guard lock(mutex_);
  state_ = AppStateId::kTagDetected;
  tag_uid_.size = uid.size();
  std::copy(uid.begin(), uid.end(), tag_uid_.bytes.begin());
  ntag_uid_ = {};
  user_label_.clear();
  auth_id_ = FirebaseId::Empty();
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

void AppState::OnAuthorizing() {
  std::lock_guard lock(mutex_);
  state_ = AppStateId::kAuthorizing;
}

void AppState::OnAuthorized(std::string_view user_label,
                             const FirebaseId& auth_id) {
  std::lock_guard lock(mutex_);
  state_ = AppStateId::kAuthorized;
  user_label_ = pw::InlineString<64>(user_label);
  auth_id_ = auth_id;
}

void AppState::OnUnauthorized() {
  std::lock_guard lock(mutex_);
  state_ = AppStateId::kUnauthorized;
}

void AppState::OnTagRemoved() {
  std::lock_guard lock(mutex_);
  state_ = AppStateId::kIdle;
  tag_uid_ = {};
  ntag_uid_ = {};
  user_label_.clear();
  auth_id_ = FirebaseId::Empty();
}

}  // namespace maco::app_state
