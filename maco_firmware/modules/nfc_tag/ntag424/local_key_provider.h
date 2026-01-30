// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <optional>

#include "maco_firmware/modules/nfc_tag/ntag424/ntag424_key_provider.h"
#include "pw_async2/coro.h"
#include "pw_bytes/span.h"
#include "pw_random/random.h"
#include "pw_result/result.h"

namespace maco::nfc {

/// Key provider for local authentication when the terminal knows the key.
///
/// This implementation performs all crypto operations locally and synchronously.
/// The coroutines immediately co_return with results since no async IO is needed.
///
/// Usage:
/// 1. Construct with key number, key bytes, and RNG
/// 2. co_await CreateNtagChallenge() after Part 1
/// 3. co_await VerifyAndComputeSessionKeys() after Part 3
/// 4. Call CancelAuthentication() on errors
class LocalKeyProvider : public Ntag424KeyProvider {
 public:
  /// Construct a local key provider.
  /// @param key_number Key slot (0-4) to authenticate with
  /// @param key 16-byte AES key
  /// @param rng Random number generator for RndA generation
  LocalKeyProvider(uint8_t key_number,
                   pw::ConstByteSpan key,
                   pw::random::RandomGenerator& rng);

  /// Destructor securely zeroes key material.
  ~LocalKeyProvider() override;

  /// Get the key slot number this provider authenticates.
  uint8_t key_number() const override { return key_number_; }

  /// Create Part 2 response (synchronous, returns immediately).
  pw::async2::Coro<pw::Result<std::array<std::byte, 32>>> CreateNtagChallenge(
      pw::async2::CoroContext& cx,
      pw::ConstByteSpan encrypted_rnd_b) override;

  /// Verify Part 3 and compute session keys (synchronous, returns immediately).
  pw::async2::Coro<pw::Result<SessionKeys>> VerifyAndComputeSessionKeys(
      pw::async2::CoroContext& cx,
      pw::ConstByteSpan encrypted_part3) override;

  /// Clear stored RndA/RndB state.
  void CancelAuthentication() override;

 private:
  uint8_t key_number_;
  std::array<std::byte, 16> key_;
  pw::random::RandomGenerator& rng_;

  // State stored between CreateNtagChallenge and VerifyAndComputeSessionKeys
  std::optional<std::array<std::byte, 16>> stored_rnd_a_;
  std::optional<std::array<std::byte, 16>> stored_rnd_b_;
};

}  // namespace maco::nfc
