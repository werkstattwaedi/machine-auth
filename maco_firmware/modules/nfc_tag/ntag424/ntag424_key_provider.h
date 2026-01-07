// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <array>
#include <cstddef>
#include <cstdint>

#include "pw_bytes/span.h"
#include "pw_result/result.h"

namespace maco::nfc {

/// Result of authentication crypto computation.
/// Returned by Ntag424KeyProvider::ComputeAuthResponse().
struct AuthComputeResult {
  /// Part 2 response data (encrypted RndA||RndB' for AuthenticateEV2First).
  std::array<std::byte, 32> part2_response;

  /// Derived session encryption key.
  std::array<std::byte, 16> ses_auth_enc_key;

  /// Derived session MAC key.
  std::array<std::byte, 16> ses_auth_mac_key;

  /// Transaction identifier (TI) - first 4 bytes of Part 2 response.
  std::array<std::byte, 4> transaction_identifier;
};

/// Abstract interface for NTAG424 authentication key operations.
///
/// This interface allows injecting the crypto computation between Part 1 and
/// Part 2 of AuthenticateEV2First. Implementations can:
/// - LocalKeyProvider: Compute locally when terminal knows the key bytes
/// - CloudKeyProvider: Delegate to cloud service when key is not on terminal
///
/// Each provider instance represents a specific key (number + secret).
class Ntag424KeyProvider {
 public:
  virtual ~Ntag424KeyProvider() = default;

  /// Get the key slot number this provider authenticates (0-4).
  virtual uint8_t key_number() const = 0;

  /// Compute authentication response given tag's challenge.
  ///
  /// Called between Part 1 and Part 2 of AuthenticateEV2First.
  /// The implementation must:
  /// 1. Decrypt encrypted_rnd_b using the key to get RndB
  /// 2. Rotate RndB left by 1 byte to get RndB'
  /// 3. Encrypt RndA||RndB' to form the Part 2 response
  /// 4. Derive session keys using SV1/SV2 vectors from RndA and RndB
  ///
  /// @param rnd_a Terminal's random challenge (16 bytes, caller generates)
  /// @param encrypted_rnd_b Tag's encrypted challenge from Part 1 response
  /// @return Computed response and derived session keys, or error
  virtual pw::Result<AuthComputeResult> ComputeAuthResponse(
      pw::ConstByteSpan rnd_a,
      pw::ConstByteSpan encrypted_rnd_b) = 0;
};

}  // namespace maco::nfc
