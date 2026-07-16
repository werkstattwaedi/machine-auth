// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

namespace maco::app_state {

enum class TagVerificationState {
  kIdle,         // No tag present
  kTagDetected,  // Tag at RF layer, checking capabilities
  kVerifying,    // Terminal key auth in progress
  kGenuine,      // Verified OWW tag, real UID known
  kUnknownTag,   // Not ISO 14443-4, or auth failed
  kAuthorizing,  // Cloud authorization in progress
  kAuthorized,   // Cloud authorized, auth_id obtained
  kUnauthorized, // Cloud rejected the user
  kRemovedTooEarly,  // Badge left the field mid-authorization; ask to hold longer
};

}  // namespace maco::app_state
