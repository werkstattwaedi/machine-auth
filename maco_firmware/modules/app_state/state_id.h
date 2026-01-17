// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

namespace maco::app_state {

// Placeholder states - validates threading pattern; real HFSM designed later
enum class AppStateId {
  kNoTag,   // No tag present
  kHasTag,  // Tag detected (UID available in snapshot)
};

}  // namespace maco::app_state
