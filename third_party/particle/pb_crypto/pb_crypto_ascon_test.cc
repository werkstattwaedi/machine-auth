// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "pb_crypto/pb_crypto.h"

#include <array>
#include <cstring>

#include "pw_bytes/array.h"
#include "pw_unit_test/framework.h"

namespace pb::crypto {
namespace {

// Test vectors from ASCON specification
// https://ascon.iaik.tugraz.at/

TEST(AsconAead128Test, EncryptDecryptRoundTrip) {
  constexpr auto kKey = pw::bytes::Array<0x00, 0x01, 0x02, 0x03, 0x04, 0x05,
                                         0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b,
                                         0x0c, 0x0d, 0x0e, 0x0f>();

  constexpr auto kNonce = pw::bytes::Array<0x00, 0x01, 0x02, 0x03, 0x04, 0x05,
                                           0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b,
                                           0x0c, 0x0d, 0x0e, 0x0f>();

  constexpr auto kPlaintext =
      pw::bytes::Array<'H', 'e', 'l', 'l', 'o', ' ', 'W', 'o', 'r', 'l', 'd'>();

  constexpr auto kAssociatedData =
      pw::bytes::Array<'A', 'D', ' ', 'd', 'a', 't', 'a'>();

  std::array<std::byte, kPlaintext.size()> ciphertext{};
  std::array<std::byte, kAsconTagSize> tag{};
  std::array<std::byte, kPlaintext.size()> decrypted{};

  // Encrypt
  ASSERT_EQ(AsconAead128Encrypt(kKey,
                                kNonce,
                                kAssociatedData,
                                kPlaintext,
                                ciphertext,
                                tag),
            pw::OkStatus());

  // Ciphertext should be different from plaintext
  EXPECT_NE(std::memcmp(ciphertext.data(), kPlaintext.data(), kPlaintext.size()),
            0);

  // Decrypt
  ASSERT_EQ(AsconAead128Decrypt(
                kKey, kNonce, kAssociatedData, ciphertext, tag, decrypted),
            pw::OkStatus());

  // Decrypted should match original plaintext
  EXPECT_EQ(std::memcmp(decrypted.data(), kPlaintext.data(), kPlaintext.size()),
            0);
}

TEST(AsconAead128Test, EncryptDecryptEmptyMessage) {
  constexpr auto kKey = pw::bytes::Array<0x00, 0x01, 0x02, 0x03, 0x04, 0x05,
                                         0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b,
                                         0x0c, 0x0d, 0x0e, 0x0f>();

  constexpr auto kNonce = pw::bytes::Array<0x00, 0x01, 0x02, 0x03, 0x04, 0x05,
                                           0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b,
                                           0x0c, 0x0d, 0x0e, 0x0f>();

  pw::ConstByteSpan empty_plaintext{};
  pw::ConstByteSpan empty_ad{};

  std::array<std::byte, kAsconTagSize> tag{};

  // Encrypt empty message (authentication only)
  ASSERT_EQ(AsconAead128Encrypt(kKey, kNonce, empty_ad, empty_plaintext, {}, tag),
            pw::OkStatus());

  // Decrypt (verify tag)
  ASSERT_EQ(AsconAead128Decrypt(kKey, kNonce, empty_ad, {}, tag, {}),
            pw::OkStatus());
}

TEST(AsconAead128Test, DecryptFailsWithWrongKey) {
  constexpr auto kKey = pw::bytes::Array<0x00, 0x01, 0x02, 0x03, 0x04, 0x05,
                                         0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b,
                                         0x0c, 0x0d, 0x0e, 0x0f>();

  constexpr auto kWrongKey = pw::bytes::Array<0xff, 0x01, 0x02, 0x03, 0x04, 0x05,
                                              0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b,
                                              0x0c, 0x0d, 0x0e, 0x0f>();

  constexpr auto kNonce = pw::bytes::Array<0x00, 0x01, 0x02, 0x03, 0x04, 0x05,
                                           0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b,
                                           0x0c, 0x0d, 0x0e, 0x0f>();

  constexpr auto kPlaintext = pw::bytes::Array<'t', 'e', 's', 't'>();

  std::array<std::byte, kPlaintext.size()> ciphertext{};
  std::array<std::byte, kAsconTagSize> tag{};
  std::array<std::byte, kPlaintext.size()> decrypted{};

  // Encrypt with correct key
  ASSERT_EQ(
      AsconAead128Encrypt(kKey, kNonce, {}, kPlaintext, ciphertext, tag),
      pw::OkStatus());

  // Decrypt with wrong key should fail
  EXPECT_EQ(AsconAead128Decrypt(kWrongKey, kNonce, {}, ciphertext, tag, decrypted),
            pw::Status::Unauthenticated());
}

TEST(AsconAead128Test, DecryptFailsWithModifiedCiphertext) {
  constexpr auto kKey = pw::bytes::Array<0x00, 0x01, 0x02, 0x03, 0x04, 0x05,
                                         0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b,
                                         0x0c, 0x0d, 0x0e, 0x0f>();

  constexpr auto kNonce = pw::bytes::Array<0x00, 0x01, 0x02, 0x03, 0x04, 0x05,
                                           0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b,
                                           0x0c, 0x0d, 0x0e, 0x0f>();

  constexpr auto kPlaintext = pw::bytes::Array<'t', 'e', 's', 't'>();

  std::array<std::byte, kPlaintext.size()> ciphertext{};
  std::array<std::byte, kAsconTagSize> tag{};
  std::array<std::byte, kPlaintext.size()> decrypted{};

  // Encrypt
  ASSERT_EQ(
      AsconAead128Encrypt(kKey, kNonce, {}, kPlaintext, ciphertext, tag),
      pw::OkStatus());

  // Modify ciphertext
  ciphertext[0] ^= std::byte{0xff};

  // Decrypt should fail
  EXPECT_EQ(AsconAead128Decrypt(kKey, kNonce, {}, ciphertext, tag, decrypted),
            pw::Status::Unauthenticated());
}

TEST(AsconAead128Test, DecryptFailsWithModifiedTag) {
  constexpr auto kKey = pw::bytes::Array<0x00, 0x01, 0x02, 0x03, 0x04, 0x05,
                                         0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b,
                                         0x0c, 0x0d, 0x0e, 0x0f>();

  constexpr auto kNonce = pw::bytes::Array<0x00, 0x01, 0x02, 0x03, 0x04, 0x05,
                                           0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b,
                                           0x0c, 0x0d, 0x0e, 0x0f>();

  constexpr auto kPlaintext = pw::bytes::Array<'t', 'e', 's', 't'>();

  std::array<std::byte, kPlaintext.size()> ciphertext{};
  std::array<std::byte, kAsconTagSize> tag{};
  std::array<std::byte, kPlaintext.size()> decrypted{};

  // Encrypt
  ASSERT_EQ(
      AsconAead128Encrypt(kKey, kNonce, {}, kPlaintext, ciphertext, tag),
      pw::OkStatus());

  // Modify tag
  tag[0] ^= std::byte{0xff};

  // Decrypt should fail
  EXPECT_EQ(AsconAead128Decrypt(kKey, kNonce, {}, ciphertext, tag, decrypted),
            pw::Status::Unauthenticated());
}

TEST(AsconAead128Test, DecryptFailsWithWrongAssociatedData) {
  constexpr auto kKey = pw::bytes::Array<0x00, 0x01, 0x02, 0x03, 0x04, 0x05,
                                         0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b,
                                         0x0c, 0x0d, 0x0e, 0x0f>();

  constexpr auto kNonce = pw::bytes::Array<0x00, 0x01, 0x02, 0x03, 0x04, 0x05,
                                           0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b,
                                           0x0c, 0x0d, 0x0e, 0x0f>();

  constexpr auto kPlaintext = pw::bytes::Array<'t', 'e', 's', 't'>();
  constexpr auto kAd = pw::bytes::Array<'a', 'd'>();
  constexpr auto kWrongAd = pw::bytes::Array<'x', 'y'>();

  std::array<std::byte, kPlaintext.size()> ciphertext{};
  std::array<std::byte, kAsconTagSize> tag{};
  std::array<std::byte, kPlaintext.size()> decrypted{};

  // Encrypt with AD
  ASSERT_EQ(
      AsconAead128Encrypt(kKey, kNonce, kAd, kPlaintext, ciphertext, tag),
      pw::OkStatus());

  // Decrypt with wrong AD should fail
  EXPECT_EQ(AsconAead128Decrypt(kKey, kNonce, kWrongAd, ciphertext, tag, decrypted),
            pw::Status::Unauthenticated());
}

TEST(AsconAead128Test, InvalidKeySize) {
  constexpr auto kShortKey = pw::bytes::Array<0x00, 0x01, 0x02, 0x03>();
  constexpr auto kNonce = pw::bytes::Array<0x00, 0x01, 0x02, 0x03, 0x04, 0x05,
                                           0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b,
                                           0x0c, 0x0d, 0x0e, 0x0f>();
  std::array<std::byte, kAsconTagSize> tag{};

  EXPECT_EQ(AsconAead128Encrypt(kShortKey, kNonce, {}, {}, {}, tag),
            pw::Status::InvalidArgument());
}

TEST(AsconAead128Test, InvalidNonceSize) {
  constexpr auto kKey = pw::bytes::Array<0x00, 0x01, 0x02, 0x03, 0x04, 0x05,
                                         0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b,
                                         0x0c, 0x0d, 0x0e, 0x0f>();
  constexpr auto kShortNonce = pw::bytes::Array<0x00, 0x01, 0x02, 0x03>();
  std::array<std::byte, kAsconTagSize> tag{};

  EXPECT_EQ(AsconAead128Encrypt(kKey, kShortNonce, {}, {}, {}, tag),
            pw::Status::InvalidArgument());
}

TEST(AsconHash256Test, HashEmptyMessage) {
  std::array<std::byte, kAsconHashSize> hash{};

  ASSERT_EQ(AsconHash256({}, hash), pw::OkStatus());

  // Hash of empty message should be non-zero
  bool all_zero = true;
  for (auto b : hash) {
    if (b != std::byte{0}) {
      all_zero = false;
      break;
    }
  }
  EXPECT_FALSE(all_zero);
}

TEST(AsconHash256Test, HashDeterministic) {
  constexpr auto kMessage = pw::bytes::Array<'t', 'e', 's', 't'>();

  std::array<std::byte, kAsconHashSize> hash1{};
  std::array<std::byte, kAsconHashSize> hash2{};

  ASSERT_EQ(AsconHash256(kMessage, hash1), pw::OkStatus());
  ASSERT_EQ(AsconHash256(kMessage, hash2), pw::OkStatus());

  // Same message should produce same hash
  EXPECT_EQ(std::memcmp(hash1.data(), hash2.data(), kAsconHashSize), 0);
}

TEST(AsconHash256Test, DifferentMessagesDifferentHashes) {
  constexpr auto kMessage1 = pw::bytes::Array<'t', 'e', 's', 't', '1'>();
  constexpr auto kMessage2 = pw::bytes::Array<'t', 'e', 's', 't', '2'>();

  std::array<std::byte, kAsconHashSize> hash1{};
  std::array<std::byte, kAsconHashSize> hash2{};

  ASSERT_EQ(AsconHash256(kMessage1, hash1), pw::OkStatus());
  ASSERT_EQ(AsconHash256(kMessage2, hash2), pw::OkStatus());

  // Different messages should produce different hashes
  EXPECT_NE(std::memcmp(hash1.data(), hash2.data(), kAsconHashSize), 0);
}

TEST(AsconHash256Test, HashBufferTooSmall) {
  constexpr auto kMessage = pw::bytes::Array<'t', 'e', 's', 't'>();
  std::array<std::byte, 16> small_hash{};  // 16 bytes, need 32

  EXPECT_EQ(AsconHash256(kMessage, small_hash), pw::Status::ResourceExhausted());
}

}  // namespace
}  // namespace pb::crypto
