// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <array>
#include <cstddef>

#include "maco_firmware/modules/app_state/state_id.h"
#include "maco_firmware/types.h"
#include "pw_chrono/system_clock.h"
#include "pw_string/string.h"

namespace maco::app_state {

// Maximum tag UID size (NTAG424 uses 7 bytes, but allow for other tags)
inline constexpr size_t kMaxTagUidSize = 10;

// Tag UID with size (value type, safe to copy)
struct TagUid {
  std::array<std::byte, kMaxTagUidSize> bytes{};
  size_t size = 0;

  bool empty() const { return size == 0; }
};

// Session state for UI display
enum class SessionStateUi : uint8_t {
  kNoSession = 0,
  kRunning = 1,
  kCheckoutPending = 2,
  kTakeoverPending = 3,
};

// Session snapshot for UI - confirmation progress and user labels
struct SessionSnapshotUi {
  SessionStateUi state = SessionStateUi::kNoSession;
  pw::InlineString<64> session_user_label;
  pw::InlineString<64> pending_user_label;  // For takeover display
  pw::chrono::SystemClock::time_point pending_since;
  pw::chrono::SystemClock::time_point pending_deadline;
  pw::chrono::SystemClock::time_point tag_present_since;
  bool tag_present = false;
};

// Snapshot for UI thread - copied by value, no dangling references.
// This is the read-only view of app state that screens receive.
struct AppStateSnapshot {
  AppStateId state = AppStateId::kIdle;
  TagUid tag_uid;   // RF-layer UID (kTagDetected onward)
  TagUid ntag_uid;  // Real 7-byte NTAG424 UID from GetCardUid (kGenuine only)

  // Authorization fields (kAuthorized only)
  pw::InlineString<64> user_label;
  maco::FirebaseId auth_id = maco::FirebaseId::Empty();

  // Session state
  SessionSnapshotUi session;
};

}  // namespace maco::app_state
