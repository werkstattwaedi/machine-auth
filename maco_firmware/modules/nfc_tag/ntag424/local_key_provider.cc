// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/modules/nfc_tag/ntag424/local_key_provider.h"

#include <algorithm>
#include <array>

#include "maco_firmware/modules/nfc_tag/ntag424/ntag424_crypto.h"
#include "pw_assert/check.h"
#include "pw_status/try.h"

namespace maco::nfc {

namespace {
constexpr size_t kKeySize = 16;
constexpr size_t kBlockSize = 16;

// Zero IV used for all NTAG424 authentication operations
constexpr std::array<std::byte, kBlockSize> kZeroIv = {};
}  // namespace

LocalKeyProvider::LocalKeyProvider(uint8_t key_number, pw::ConstByteSpan key)
    : key_number_(key_number) {
  PW_CHECK_INT_EQ(key.size(), kKeySize, "Key must be 16 bytes");
  std::copy(key.begin(), key.end(), key_.begin());
}

pw::Result<AuthComputeResult> LocalKeyProvider::ComputeAuthResponse(
    pw::ConstByteSpan rnd_a,
    pw::ConstByteSpan encrypted_rnd_b) {
  // Validate inputs
  if (rnd_a.size() != kBlockSize) {
    return pw::Status::InvalidArgument();
  }
  if (encrypted_rnd_b.size() != kBlockSize) {
    return pw::Status::InvalidArgument();
  }

  AuthComputeResult result;

  // Step 1: Decrypt encrypted_rnd_b to get RndB
  std::array<std::byte, kBlockSize> rnd_b;
  PW_TRY(AesCbcDecrypt(key_, kZeroIv, encrypted_rnd_b, rnd_b));

  // Step 2: Rotate RndB left by 1 byte to get RndB'
  std::array<std::byte, kBlockSize> rnd_b_prime;
  RotateLeft1(rnd_b, rnd_b_prime);

  // Step 3: Build RndA || RndB' and encrypt for Part 2 response
  std::array<std::byte, 32> rnd_a_concat_rnd_b_prime;
  std::copy(rnd_a.begin(), rnd_a.end(), rnd_a_concat_rnd_b_prime.begin());
  std::copy(rnd_b_prime.begin(),
            rnd_b_prime.end(),
            rnd_a_concat_rnd_b_prime.begin() + kBlockSize);

  PW_TRY(AesCbcEncrypt(key_,
                       kZeroIv,
                       rnd_a_concat_rnd_b_prime,
                       result.part2_response));

  // Step 4: Derive session keys
  PW_TRY(DeriveSessionKeys(key_,
                           rnd_a,
                           rnd_b,
                           result.ses_auth_enc_key,
                           result.ses_auth_mac_key));

  // Step 5: Transaction identifier is TI from the tag's response to Part 2
  // For AuthenticateEV2First, TI is returned in the tag's Part 2 response,
  // so we can't compute it here. The caller will extract it from the response.
  // Set to zero placeholder - the authentication flow will update this.
  std::fill(result.transaction_identifier.begin(),
            result.transaction_identifier.end(),
            std::byte{0});

  return result;
}

}  // namespace maco::nfc
