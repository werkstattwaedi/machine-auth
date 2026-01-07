// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/modules/nfc_tag/ntag424/ntag424_crypto.h"

#include <algorithm>
#include <array>

#include "pb_crypto/pb_crypto.h"
#include "pw_assert/check.h"
#include "pw_status/try.h"

namespace maco::nfc {

namespace {

constexpr size_t kKeySize = pb::crypto::kAesKeySize;

// SV prefix constants
constexpr std::byte kSV1Prefix0{0xA5};
constexpr std::byte kSV1Prefix1{0x5A};
constexpr std::byte kSV2Prefix0{0x5A};
constexpr std::byte kSV2Prefix1{0xA5};

// Calculate SV vector (common implementation for SV1 and SV2).
// SV = b0 b1 || 0x00 0x01 0x00 0x80 || RndA[15:14] ||
//      (RndA[13:8] XOR RndB[15:10]) || RndB[9:0] || RndA[7:0]
void CalculateSV(std::byte b0,
                 std::byte b1,
                 pw::ConstByteSpan rnd_a,
                 pw::ConstByteSpan rnd_b,
                 pw::ByteSpan sv) {
  PW_CHECK_INT_EQ(rnd_a.size(), 16);
  PW_CHECK_INT_EQ(rnd_b.size(), 16);
  PW_CHECK_INT_GE(sv.size(), 32);

  // Bytes 0-1: Prefix
  sv[0] = b0;
  sv[1] = b1;

  // Bytes 2-5: Fixed constants 0x00 0x01 0x00 0x80
  sv[2] = std::byte{0x00};
  sv[3] = std::byte{0x01};
  sv[4] = std::byte{0x00};
  sv[5] = std::byte{0x80};

  // Bytes 6-7: RndA[15:14] (first 2 bytes of RndA)
  sv[6] = rnd_a[0];
  sv[7] = rnd_a[1];

  // Bytes 8-13: RndA[13:8] XOR RndB[15:10]
  // Start with RndB[15:10] (first 6 bytes of RndB)
  for (size_t i = 0; i < 6; ++i) {
    sv[8 + i] = rnd_b[i];
  }
  // XOR with RndA[13:8] (bytes 2-7 of RndA)
  for (size_t i = 0; i < 6; ++i) {
    sv[8 + i] = static_cast<std::byte>(static_cast<uint8_t>(sv[8 + i]) ^
                                       static_cast<uint8_t>(rnd_a[2 + i]));
  }

  // Bytes 14-23: RndB[9:0] (bytes 6-15 of RndB)
  for (size_t i = 0; i < 10; ++i) {
    sv[14 + i] = rnd_b[6 + i];
  }

  // Bytes 24-31: RndA[7:0] (bytes 8-15 of RndA)
  for (size_t i = 0; i < 8; ++i) {
    sv[24 + i] = rnd_a[8 + i];
  }
}

}  // namespace

pw::Status AesCbcEncrypt(pw::ConstByteSpan key,
                         pw::ConstByteSpan iv,
                         pw::ConstByteSpan plaintext,
                         pw::ByteSpan ciphertext) {
  return pb::crypto::AesCbcEncrypt(key, iv, plaintext, ciphertext);
}

pw::Status AesCbcDecrypt(pw::ConstByteSpan key,
                         pw::ConstByteSpan iv,
                         pw::ConstByteSpan ciphertext,
                         pw::ByteSpan plaintext) {
  return pb::crypto::AesCbcDecrypt(key, iv, ciphertext, plaintext);
}

pw::Status AesCmac(pw::ConstByteSpan key,
                   pw::ConstByteSpan data,
                   pw::ByteSpan mac) {
  return pb::crypto::AesCmac(key, data, mac);
}

void CalculateSV1(pw::ConstByteSpan rnd_a,
                  pw::ConstByteSpan rnd_b,
                  pw::ByteSpan sv1) {
  CalculateSV(kSV1Prefix0, kSV1Prefix1, rnd_a, rnd_b, sv1);
}

void CalculateSV2(pw::ConstByteSpan rnd_a,
                  pw::ConstByteSpan rnd_b,
                  pw::ByteSpan sv2) {
  CalculateSV(kSV2Prefix0, kSV2Prefix1, rnd_a, rnd_b, sv2);
}

pw::Status DeriveSessionKeys(pw::ConstByteSpan auth_key,
                             pw::ConstByteSpan rnd_a,
                             pw::ConstByteSpan rnd_b,
                             pw::ByteSpan ses_auth_enc_key,
                             pw::ByteSpan ses_auth_mac_key) {
  if (auth_key.size() != kKeySize) {
    return pw::Status::InvalidArgument();
  }
  if (rnd_a.size() != 16 || rnd_b.size() != 16) {
    return pw::Status::InvalidArgument();
  }
  if (ses_auth_enc_key.size() < kKeySize ||
      ses_auth_mac_key.size() < kKeySize) {
    return pw::Status::ResourceExhausted();
  }

  // Calculate SV1 and derive SesAuthEncKey = CMAC(AuthKey, SV1)
  std::array<std::byte, 32> sv1;
  CalculateSV1(rnd_a, rnd_b, sv1);
  PW_TRY(AesCmac(auth_key, sv1, ses_auth_enc_key));

  // Calculate SV2 and derive SesAuthMACKey = CMAC(AuthKey, SV2)
  std::array<std::byte, 32> sv2;
  CalculateSV2(rnd_a, rnd_b, sv2);
  PW_TRY(AesCmac(auth_key, sv2, ses_auth_mac_key));

  return pw::OkStatus();
}

void RotateLeft1(pw::ConstByteSpan input, pw::ByteSpan output) {
  PW_CHECK_INT_EQ(input.size(), output.size());
  PW_CHECK_INT_GE(input.size(), 1);

  const size_t len = input.size();
  const std::byte first = input[0];

  // Shift all bytes left by 1 position
  for (size_t i = 0; i < len - 1; ++i) {
    output[i] = input[i + 1];
  }
  output[len - 1] = first;
}

bool VerifyRndAPrime(pw::ConstByteSpan rnd_a, pw::ConstByteSpan rnd_a_prime) {
  if (rnd_a.size() != rnd_a_prime.size() || rnd_a.size() != 16) {
    return false;
  }

  // RndA' should be RndA rotated left by 1 byte
  // So RndA'[i] == RndA[i+1] for i < 15, and RndA'[15] == RndA[0]
  for (size_t i = 0; i < 15; ++i) {
    if (rnd_a_prime[i] != rnd_a[i + 1]) {
      return false;
    }
  }
  return rnd_a_prime[15] == rnd_a[0];
}

}  // namespace maco::nfc
