// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <array>
#include <cstddef>

#include "maco_firmware/modules/app_state/state_id.h"
#include "maco_firmware/types.h"
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

// Snapshot for UI thread - copied by value, no dangling references.
// This is the read-only view of app state that screens receive.
struct AppStateSnapshot {
  AppStateId state = AppStateId::kIdle;
  TagUid tag_uid;   // RF-layer UID (kTagDetected onward)
  TagUid ntag_uid;  // Real 7-byte NTAG424 UID from GetCardUid (kGenuine only)

  // Authorization fields (kAuthorized only)
  pw::InlineString<64> user_label;
  maco::FirebaseId auth_id = maco::FirebaseId::Empty();
};

}  // namespace maco::app_state
