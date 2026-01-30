// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <array>
#include <cstddef>
#include <cstdint>

#include "pw_async2/coro.h"
#include "pw_bytes/span.h"
#include "pw_result/result.h"

namespace maco::nfc {

/// Session keys and metadata from successful authentication.
/// Returned by Ntag424KeyProvider::VerifyAndComputeSessionKeys().
///
/// The destructor securely zeroes the session keys to minimize
/// their lifetime in memory.
struct SessionKeys {
  /// Derived session encryption key.
  std::array<std::byte, 16> ses_auth_enc_key;

  /// Derived session MAC key.
  std::array<std::byte, 16> ses_auth_mac_key;

  /// Transaction identifier (TI) - first 4 bytes of Part 3 response.
  std::array<std::byte, 4> transaction_identifier;

  /// PICC capabilities (PDcap2) - 6 bytes from Part 3 response.
  std::array<std::byte, 6> picc_capabilities;

  /// Securely zero session keys on destruction.
  ~SessionKeys();
};

/// Abstract interface for NTAG424 authentication key operations.
///
/// This interface supports both local and cloud-based key providers by using
/// coroutines. The authentication flow is:
///
/// 1. Tag sends encrypted RndB (Part 1 response)
/// 2. co_await CreateNtagChallenge() - provider generates RndA, creates Part 2
/// 3. Tag sends encrypted TI||RndA'||caps (Part 3 response)
/// 4. co_await VerifyAndComputeSessionKeys() - provider verifies RndA', derives keys
///
/// The provider manages RndA internally, allowing cloud implementations to
/// generate RndA in a secure HSM.
///
/// Each provider instance represents a specific key (number + secret).
class Ntag424KeyProvider {
 public:
  virtual ~Ntag424KeyProvider() = default;

  /// Get the key slot number this provider authenticates (0-4).
  virtual uint8_t key_number() const = 0;

  /// Create the NTAG challenge response (Part 2 of AuthenticateEV2First).
  ///
  /// Called after receiving Part 1 (encrypted RndB) from the tag.
  /// The implementation must:
  /// 1. Generate RndA (16 bytes random)
  /// 2. Decrypt encrypted_rnd_b using AuthKey to get RndB
  /// 3. Rotate RndB left by 1 byte to get RndB'
  /// 4. Encrypt RndA||RndB' using AuthKey to form the Part 2 response
  /// 5. Store RndA and RndB for later use in VerifyAndComputeSessionKeys
  ///
  /// @param cx Coroutine context for frame allocation
  /// @param encrypted_rnd_b Tag's encrypted challenge from Part 1 (16 bytes)
  /// @return Coroutine resolving to 32-byte Part 2 response, or error
  virtual pw::async2::Coro<pw::Result<std::array<std::byte, 32>>>
  CreateNtagChallenge(pw::async2::CoroContext& cx,
                      pw::ConstByteSpan encrypted_rnd_b) = 0;

  /// Verify tag's response and compute session keys.
  ///
  /// Called after receiving Part 3 (encrypted TI||RndA'||caps) from the tag.
  /// The implementation must:
  /// 1. Decrypt Part 3 using AuthKey (NOT session key!)
  /// 2. Extract TI (4 bytes), RndA' (16 bytes), PDcap2 (6 bytes), PCDcap2 (6)
  /// 3. Verify RndA' matches stored RndA rotated left by 1
  /// 4. Derive session keys: SesAuthEncKey = CMAC(AuthKey, SV1)
  ///                         SesAuthMACKey = CMAC(AuthKey, SV2)
  /// 5. Clear stored RndA/RndB
  ///
  /// @param cx Coroutine context for frame allocation
  /// @param encrypted_part3 Tag's encrypted Part 3 response (32 bytes)
  /// @return Coroutine resolving to SessionKeys on success, or error
  virtual pw::async2::Coro<pw::Result<SessionKeys>> VerifyAndComputeSessionKeys(
      pw::async2::CoroContext& cx,
      pw::ConstByteSpan encrypted_part3) = 0;

  /// Cancel any in-progress authentication.
  ///
  /// Clears stored RndA/RndB and any pending state. Call on:
  /// - Communication error
  /// - Timeout
  /// - Tag removal
  virtual void CancelAuthentication() = 0;
};

}  // namespace maco::nfc
