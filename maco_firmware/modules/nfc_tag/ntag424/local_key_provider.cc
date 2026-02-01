// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/modules/nfc_tag/ntag424/local_key_provider.h"

#include <algorithm>
#include <array>

#include "maco_firmware/modules/nfc_tag/ntag424/ntag424_crypto.h"
#include "pw_assert/check.h"

namespace maco::nfc {

namespace {
constexpr size_t kKeySize = 16;
constexpr size_t kBlockSize = 16;

// Zero IV used for all NTAG424 authentication operations
constexpr std::array<std::byte, kBlockSize> kZeroIv = {};
}  // namespace

LocalKeyProvider::LocalKeyProvider(uint8_t key_number,
                                   pw::ConstByteSpan key,
                                   pw::random::RandomGenerator& rng)
    : key_number_(key_number), rng_(rng) {
  PW_CHECK_INT_EQ(key.size(), kKeySize, "Key must be 16 bytes");
  std::copy(key.begin(), key.end(), key_.begin());
}

LocalKeyProvider::~LocalKeyProvider() {
  // Securely zero the key to minimize its lifetime in memory
  SecureZero(key_);
}

pw::async2::Coro<pw::Result<std::array<std::byte, 32>>>
LocalKeyProvider::CreateNtagChallenge(
    [[maybe_unused]] pw::async2::CoroContext& cx,
    pw::ConstByteSpan encrypted_rnd_b) {
  // Validate input
  if (encrypted_rnd_b.size() != kBlockSize) {
    co_return pw::Status::InvalidArgument();
  }

  // Clear any previous state
  CancelAuthentication();

  // Step 1: Generate RndA
  std::array<std::byte, kBlockSize> rnd_a;
  rng_.Get(rnd_a);

  // Step 2: Decrypt encrypted_rnd_b to get RndB
  std::array<std::byte, kBlockSize> rnd_b;
  auto decrypt_status = AesCbcDecrypt(key_, kZeroIv, encrypted_rnd_b, rnd_b);
  if (!decrypt_status.ok()) {
    co_return decrypt_status;
  }

  // Step 3: Rotate RndB left by 1 byte to get RndB'
  std::array<std::byte, kBlockSize> rnd_b_prime;
  RotateLeft1(rnd_b, rnd_b_prime);

  // Step 4: Build RndA || RndB' and encrypt for Part 2 response
  std::array<std::byte, 32> rnd_a_concat_rnd_b_prime;
  std::copy(rnd_a.begin(), rnd_a.end(), rnd_a_concat_rnd_b_prime.begin());
  std::copy(rnd_b_prime.begin(),
            rnd_b_prime.end(),
            rnd_a_concat_rnd_b_prime.begin() + kBlockSize);

  std::array<std::byte, 32> part2_response;
  auto encrypt_status =
      AesCbcEncrypt(key_, kZeroIv, rnd_a_concat_rnd_b_prime, part2_response);
  if (!encrypt_status.ok()) {
    co_return encrypt_status;
  }

  // Step 5: Store RndA and RndB for VerifyAndComputeSessionKeys
  stored_rnd_a_ = rnd_a;
  stored_rnd_b_ = rnd_b;

  co_return part2_response;
}

pw::async2::Coro<pw::Result<SessionKeys>>
LocalKeyProvider::VerifyAndComputeSessionKeys(
    [[maybe_unused]] pw::async2::CoroContext& cx,
    pw::ConstByteSpan encrypted_part3) {
  // Validate input
  if (encrypted_part3.size() != 32) {
    co_return pw::Status::InvalidArgument();
  }

  // Check we have stored state from CreateNtagChallenge
  if (!stored_rnd_a_ || !stored_rnd_b_) {
    co_return pw::Status::FailedPrecondition();
  }

  // Step 1: Decrypt Part 3 with AuthKey (NOT session key!)
  std::array<std::byte, 32> decrypted_part3;
  auto decrypt_status =
      AesCbcDecrypt(key_, kZeroIv, encrypted_part3,
                    pw::ByteSpan(decrypted_part3.data(), 32));
  if (!decrypt_status.ok()) {
    CancelAuthentication();
    co_return decrypt_status;
  }

  // Step 2: Extract fields from decrypted Part 3
  // Layout: TI (4) || RndA' (16) || PDcap2 (6) || PCDcap2 (6)
  SessionKeys result;
  std::copy(decrypted_part3.begin(), decrypted_part3.begin() + 4,
            result.transaction_identifier.begin());

  pw::ConstByteSpan rnd_a_prime(decrypted_part3.data() + 4, 16);

  std::copy(decrypted_part3.begin() + 20, decrypted_part3.begin() + 26,
            result.picc_capabilities.begin());

  // Step 3: Verify RndA' matches stored RndA rotated left by 1
  if (!VerifyRndAPrime(*stored_rnd_a_, rnd_a_prime)) {
    CancelAuthentication();
    co_return pw::Status::Unauthenticated();
  }

  // Step 4: Derive session keys
  auto derive_status = DeriveSessionKeys(key_, *stored_rnd_a_, *stored_rnd_b_,
                                         result.ses_auth_enc_key,
                                         result.ses_auth_mac_key);
  if (!derive_status.ok()) {
    CancelAuthentication();
    co_return derive_status;
  }

  // Step 5: Clear stored state
  CancelAuthentication();

  co_return result;
}

void LocalKeyProvider::CancelAuthentication() {
  if (stored_rnd_a_) {
    SecureZero(*stored_rnd_a_);
    stored_rnd_a_.reset();
  }
  if (stored_rnd_b_) {
    SecureZero(*stored_rnd_b_);
    stored_rnd_b_.reset();
  }
}

}  // namespace maco::nfc
