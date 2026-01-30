// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <cstdint>

namespace maco::nfc {

/// Proof token for successful NTAG424 authentication.
///
/// This lightweight token proves that Authenticate() succeeded and must be
/// passed to all authenticated operations. It contains:
/// - The key number used for authentication
/// - A serial number to detect stale sessions (invalidated by re-auth)
///
/// All actual session state (keys, command counter) lives in Ntag424Tag.
/// This token is just proof that can be copied and passed around safely.
class Ntag424Session {
 public:
  /// Get the key number used for this authentication.
  uint8_t key_number() const { return key_number_; }

 private:
  friend class Ntag424Tag;

  Ntag424Session(uint8_t key_number, uint32_t auth_serial)
      : key_number_(key_number), auth_serial_(auth_serial) {}

  uint8_t key_number_;
  uint32_t auth_serial_;  // Must match Ntag424Tag's current serial
};

}  // namespace maco::nfc
