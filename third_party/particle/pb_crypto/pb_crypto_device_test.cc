// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT
//
// On-device test for pb_crypto to verify CMAC works correctly on P2.

#define PW_LOG_MODULE_NAME "crypto_test"

#include "pb_crypto/pb_crypto.h"

#include <array>
#include <cstring>

#include "pw_bytes/array.h"
#include "pw_log/log.h"
#include "pw_unit_test/framework.h"

namespace {

// RFC 4493 test key
constexpr auto kRfc4493Key = pw::bytes::Array<
    0x2b, 0x7e, 0x15, 0x16, 0x28, 0xae, 0xd2, 0xa6,
    0xab, 0xf7, 0x15, 0x88, 0x09, 0xcf, 0x4f, 0x3c>();

// RFC 4493 Example 2 - 16-byte message
constexpr auto kMessage16 = pw::bytes::Array<
    0x6b, 0xc1, 0xbe, 0xe2, 0x2e, 0x40, 0x9f, 0x96,
    0xe9, 0x3d, 0x7e, 0x11, 0x73, 0x93, 0x17, 0x2a>();

constexpr auto kExpectedMac16 = pw::bytes::Array<
    0x07, 0x0a, 0x16, 0xb4, 0x6b, 0x4d, 0x41, 0x44,
    0xf7, 0x9b, 0xdd, 0x9d, 0xd0, 0x4a, 0x28, 0x7c>();

// AN12196 test vectors
constexpr auto kAuthKey = pw::bytes::Array<
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00>();

constexpr auto kRndA = pw::bytes::Array<
    0xB9, 0x8F, 0x4C, 0x50, 0xCF, 0x1C, 0x2E, 0x08,
    0x4F, 0xD1, 0x50, 0xE3, 0x39, 0x92, 0xB0, 0x48>();

constexpr auto kRndB = pw::bytes::Array<
    0x1A, 0x8D, 0x1A, 0x22, 0x97, 0xB2, 0xA5, 0x6E,
    0x5B, 0x71, 0x7F, 0x35, 0xB8, 0x1F, 0x0E, 0x8D>();

// Expected SesAuthEncKey from AN12196
constexpr auto kExpectedSesAuthEncKey = pw::bytes::Array<
    0x7C, 0xBF, 0x71, 0x7F, 0x7F, 0x2D, 0xEF, 0x6F,
    0x6A, 0x04, 0xBD, 0xF6, 0x90, 0x14, 0x96, 0xC8>();

void LogBytes(const char* label, pw::ConstByteSpan data) {
  PW_LOG_INFO("%s:", label);
  for (size_t i = 0; i < data.size(); i += 8) {
    size_t remaining = std::min(size_t{8}, data.size() - i);
    char buf[64];
    char* p = buf;
    for (size_t j = 0; j < remaining; j++) {
      p += sprintf(p, "%02X ", static_cast<unsigned>(data[i + j]));
    }
    PW_LOG_INFO("  %s", buf);
  }
}

TEST(PbCryptoDeviceTest, AesCmac_RFC4493_16Bytes) {
  PW_LOG_INFO("=== RFC 4493 CMAC Test (16 bytes) ===");

  LogBytes("Key", kRfc4493Key);
  LogBytes("Message", kMessage16);
  LogBytes("Expected MAC", kExpectedMac16);

  std::array<std::byte, 16> mac{};
  auto status = pb::crypto::AesCmac(kRfc4493Key, kMessage16, mac);

  PW_LOG_INFO("AesCmac returned: %d", static_cast<int>(status.code()));
  LogBytes("Computed MAC", mac);

  ASSERT_EQ(status, pw::OkStatus());

  bool match = std::memcmp(mac.data(), kExpectedMac16.data(), 16) == 0;
  PW_LOG_INFO("MAC match: %s", match ? "YES" : "NO");

  EXPECT_TRUE(match) << "CMAC mismatch - device crypto broken!";
}

TEST(PbCryptoDeviceTest, AesCbcEncryptDecrypt) {
  PW_LOG_INFO("=== AES-CBC Encrypt/Decrypt Test ===");

  constexpr auto kZeroIv = pw::bytes::Array<
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00>();

  // Encrypt RndB with AuthKey (simulates tag -> PCD)
  std::array<std::byte, 16> encrypted{};
  auto enc_status = pb::crypto::AesCbcEncrypt(kAuthKey, kZeroIv, kRndB, encrypted);
  PW_LOG_INFO("Encrypt status: %d", static_cast<int>(enc_status.code()));
  LogBytes("Encrypted RndB", encrypted);

  // Decrypt it back
  std::array<std::byte, 16> decrypted{};
  auto dec_status = pb::crypto::AesCbcDecrypt(kAuthKey, kZeroIv, encrypted, decrypted);
  PW_LOG_INFO("Decrypt status: %d", static_cast<int>(dec_status.code()));
  LogBytes("Decrypted", decrypted);
  LogBytes("Original RndB", kRndB);

  ASSERT_EQ(enc_status, pw::OkStatus());
  ASSERT_EQ(dec_status, pw::OkStatus());

  bool match = std::memcmp(decrypted.data(), kRndB.data(), 16) == 0;
  PW_LOG_INFO("Round-trip match: %s", match ? "YES" : "NO");

  EXPECT_TRUE(match);
}

TEST(PbCryptoDeviceTest, SessionKeyDerivation) {
  PW_LOG_INFO("=== Session Key Derivation Test ===");

  // Compute SV1 manually to see intermediate values
  // SV1 = 0xA5 0x5A 0x00 0x01 0x00 0x80 || RndA[0:1] ||
  //       (RndA[2:7] XOR RndB[0:5]) || RndB[6:15] || RndA[8:15]
  std::array<std::byte, 32> sv1{};
  sv1[0] = std::byte{0xA5};
  sv1[1] = std::byte{0x5A};
  sv1[2] = std::byte{0x00};
  sv1[3] = std::byte{0x01};
  sv1[4] = std::byte{0x00};
  sv1[5] = std::byte{0x80};
  // RndA[0:1]
  sv1[6] = kRndA[0];
  sv1[7] = kRndA[1];
  // RndA[2:7] XOR RndB[0:5]
  for (int i = 0; i < 6; i++) {
    sv1[8 + i] = static_cast<std::byte>(
        static_cast<uint8_t>(kRndA[2 + i]) ^ static_cast<uint8_t>(kRndB[i]));
  }
  // RndB[6:15]
  for (int i = 0; i < 10; i++) {
    sv1[14 + i] = kRndB[6 + i];
  }
  // RndA[8:15]
  for (int i = 0; i < 8; i++) {
    sv1[24 + i] = kRndA[8 + i];
  }

  LogBytes("SV1", sv1);
  LogBytes("AuthKey", kAuthKey);

  // Compute CMAC(AuthKey, SV1) = SesAuthEncKey
  std::array<std::byte, 16> ses_auth_enc_key{};
  auto status = pb::crypto::AesCmac(kAuthKey, sv1, ses_auth_enc_key);

  PW_LOG_INFO("CMAC status: %d", static_cast<int>(status.code()));
  LogBytes("Computed SesAuthEncKey", ses_auth_enc_key);
  LogBytes("Expected SesAuthEncKey", kExpectedSesAuthEncKey);

  ASSERT_EQ(status, pw::OkStatus());

  bool match = std::memcmp(ses_auth_enc_key.data(),
                           kExpectedSesAuthEncKey.data(), 16) == 0;
  PW_LOG_INFO("SesAuthEncKey match: %s", match ? "YES" : "NO");

  EXPECT_TRUE(match) << "Session key derivation failed!";
}

}  // namespace
