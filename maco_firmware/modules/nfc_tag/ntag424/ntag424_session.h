// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <cstdint>

namespace maco::nfc {

/// Capability token proving successful NTAG424 authentication.
///
/// This is NOT a session holder - all state (keys, command counter) lives
/// in Ntag424Tag. This token is just proof that Authenticate() succeeded
/// and must be passed to authenticated operations.
///
/// Design rationale:
/// - All state stays in Ntag424Tag (single source of truth)
/// - Ntag424Session is proof that Authenticate() succeeded
/// - Simplifies state management
/// - Command counter increments even for unauthenticated calls post-auth
class Ntag424Session {
 public:
  /// Check if session is still valid (tag still present, not invalidated).
  bool is_valid() const { return valid_; }

  /// Get the key number used for this authentication.
  uint8_t key_number() const { return key_number_; }

 private:
  friend class Ntag424TagBase;  // Only tag can create/invalidate sessions

  explicit Ntag424Session(uint8_t key_number)
      : key_number_(key_number), valid_(true) {}

  void Invalidate() { valid_ = false; }

  uint8_t key_number_;
  bool valid_;
};

}  // namespace maco::nfc
