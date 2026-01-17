// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <array>
#include <cstddef>

#include "maco_firmware/modules/app_state/state_id.h"

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
  AppStateId state = AppStateId::kNoTag;
  TagUid tag_uid;  // Valid when state == kHasTag
};

}  // namespace maco::app_state
