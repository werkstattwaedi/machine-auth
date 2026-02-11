// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

namespace maco::app_state {

enum class AppStateId {
  kIdle,        // No tag present
  kTagDetected, // Tag at RF layer, checking capabilities
  kVerifying,   // Terminal key auth in progress
  kGenuine,     // Verified OWW tag, real UID known
  kUnknownTag,  // Not ISO 14443-4, or auth failed
};

}  // namespace maco::app_state
