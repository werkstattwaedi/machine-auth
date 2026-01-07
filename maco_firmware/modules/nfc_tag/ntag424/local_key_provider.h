// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <array>
#include <cstddef>
#include <cstdint>

#include "maco_firmware/modules/nfc_tag/ntag424/ntag424_key_provider.h"
#include "pw_bytes/span.h"
#include "pw_result/result.h"

namespace maco::nfc {

/// Key provider for local authentication when the terminal knows the key.
///
/// This implementation performs all crypto operations locally:
/// 1. Decrypts encrypted_rnd_b from the tag using the key
/// 2. Rotates RndB to get RndB'
/// 3. Encrypts RndA||RndB' as the Part 2 response
/// 4. Derives session keys using SV1/SV2 vectors
class LocalKeyProvider : public Ntag424KeyProvider {
 public:
  /// Construct a local key provider.
  /// @param key_number Key slot (0-4) to authenticate with
  /// @param key 16-byte AES key
  LocalKeyProvider(uint8_t key_number, pw::ConstByteSpan key);

  /// Get the key slot number this provider authenticates.
  uint8_t key_number() const override { return key_number_; }

  /// Compute authentication response locally.
  ///
  /// This implementation:
  /// 1. Decrypts encrypted_rnd_b using AES-CBC with zero IV
  /// 2. Rotates RndB left by 1 byte to get RndB'
  /// 3. Encrypts RndA||RndB' using AES-CBC with zero IV
  /// 4. Derives session keys using CMAC(key, SV1) and CMAC(key, SV2)
  /// 5. Extracts transaction identifier from first 4 bytes of decrypted response
  pw::Result<AuthComputeResult> ComputeAuthResponse(
      pw::ConstByteSpan rnd_a,
      pw::ConstByteSpan encrypted_rnd_b) override;

 private:
  uint8_t key_number_;
  std::array<std::byte, 16> key_;
};

}  // namespace maco::nfc
