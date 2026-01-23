// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/// @file ntag424_secure_messaging_test.cc
/// @brief Unit tests for NTAG424 DNA secure messaging.
///
/// Test vectors derived from NXP AN12196 and reference implementations.

#include "maco_firmware/modules/nfc_tag/ntag424/ntag424_secure_messaging.h"

#include <array>
#include <cstring>

#include "pw_bytes/array.h"
#include "pw_unit_test/framework.h"

namespace maco::nfc {
namespace {

// ============================================================================
// Test Data
// ============================================================================

// Session keys (computed from AuthenticateEV2First with all-zero key)
constexpr auto kSesAuthEncKey = pw::bytes::Array<
    0x7C, 0xBF, 0x71, 0x7F, 0x7F, 0x2D, 0xEF, 0x6F,
    0x6A, 0x04, 0xBD, 0xF6, 0x90, 0x14, 0x96, 0xC8>();

constexpr auto kSesAuthMacKey = pw::bytes::Array<
    0x35, 0xD8, 0x71, 0xAE, 0xFA, 0x93, 0xF7, 0xEF,
    0x36, 0x07, 0xE9, 0x70, 0x47, 0x33, 0x12, 0x82>();

// Transaction identifier (from authentication response)
constexpr auto kTI = pw::bytes::Array<0x12, 0x34, 0x56, 0x78>();

// ============================================================================
// Construction Tests
// ============================================================================

TEST(SecureMessagingTest, Construction_ValidKeys) {
  SecureMessaging sm(kSesAuthEncKey, kSesAuthMacKey, kTI);

  EXPECT_EQ(sm.command_counter(), 0);
  auto ti = sm.transaction_identifier();
  EXPECT_EQ(ti.size(), 4u);
  EXPECT_EQ(ti[0], std::byte{0x12});
  EXPECT_EQ(ti[1], std::byte{0x34});
  EXPECT_EQ(ti[2], std::byte{0x56});
  EXPECT_EQ(ti[3], std::byte{0x78});
}

TEST(SecureMessagingTest, Construction_InitialCounter) {
  SecureMessaging sm(kSesAuthEncKey, kSesAuthMacKey, kTI, 42);
  EXPECT_EQ(sm.command_counter(), 42);
}

// ============================================================================
// Counter Management Tests
// ============================================================================

TEST(SecureMessagingTest, IncrementCounter_Normal) {
  SecureMessaging sm(kSesAuthEncKey, kSesAuthMacKey, kTI);

  EXPECT_EQ(sm.command_counter(), 0);
  EXPECT_TRUE(sm.IncrementCounter());
  EXPECT_EQ(sm.command_counter(), 1);
  EXPECT_TRUE(sm.IncrementCounter());
  EXPECT_EQ(sm.command_counter(), 2);
}

TEST(SecureMessagingTest, IncrementCounter_Overflow) {
  SecureMessaging sm(kSesAuthEncKey, kSesAuthMacKey, kTI, 0xFFFF);

  // Should fail at max value
  EXPECT_FALSE(sm.IncrementCounter());
  EXPECT_EQ(sm.command_counter(), 0xFFFF);  // Unchanged
}

TEST(SecureMessagingTest, IncrementCounter_NearOverflow) {
  SecureMessaging sm(kSesAuthEncKey, kSesAuthMacKey, kTI, 0xFFFE);

  EXPECT_TRUE(sm.IncrementCounter());
  EXPECT_EQ(sm.command_counter(), 0xFFFF);

  // Next increment should fail
  EXPECT_FALSE(sm.IncrementCounter());
  EXPECT_EQ(sm.command_counter(), 0xFFFF);
}

// ============================================================================
// IV Calculation Tests
// ============================================================================

TEST(SecureMessagingTest, CalculateIVCmd_Structure) {
  SecureMessaging sm(kSesAuthEncKey, kSesAuthMacKey, kTI);

  std::array<std::byte, 16> iv{};
  ASSERT_EQ(sm.CalculateIVCmd(iv), pw::OkStatus());

  // IV should be 16 bytes and non-zero
  bool all_zero = true;
  for (auto b : iv) {
    if (b != std::byte{0}) {
      all_zero = false;
      break;
    }
  }
  EXPECT_FALSE(all_zero);
}

TEST(SecureMessagingTest, CalculateIVResp_Structure) {
  SecureMessaging sm(kSesAuthEncKey, kSesAuthMacKey, kTI);

  std::array<std::byte, 16> iv{};
  ASSERT_EQ(sm.CalculateIVResp(iv), pw::OkStatus());

  // IV should be 16 bytes and non-zero
  bool all_zero = true;
  for (auto b : iv) {
    if (b != std::byte{0}) {
      all_zero = false;
      break;
    }
  }
  EXPECT_FALSE(all_zero);
}

TEST(SecureMessagingTest, CalculateIV_CmdAndRespDiffer) {
  SecureMessaging sm(kSesAuthEncKey, kSesAuthMacKey, kTI);

  std::array<std::byte, 16> iv_cmd{};
  std::array<std::byte, 16> iv_resp{};

  ASSERT_EQ(sm.CalculateIVCmd(iv_cmd), pw::OkStatus());
  ASSERT_EQ(sm.CalculateIVResp(iv_resp), pw::OkStatus());

  // IVCmd and IVResp should be different
  EXPECT_NE(std::memcmp(iv_cmd.data(), iv_resp.data(), 16), 0);
}

TEST(SecureMessagingTest, CalculateIV_ChangesWithCounter) {
  SecureMessaging sm(kSesAuthEncKey, kSesAuthMacKey, kTI);

  std::array<std::byte, 16> iv1{};
  ASSERT_EQ(sm.CalculateIVCmd(iv1), pw::OkStatus());

  sm.IncrementCounter();

  std::array<std::byte, 16> iv2{};
  ASSERT_EQ(sm.CalculateIVCmd(iv2), pw::OkStatus());

  // IV should change with counter
  EXPECT_NE(std::memcmp(iv1.data(), iv2.data(), 16), 0);
}

TEST(SecureMessagingTest, CalculateIV_Deterministic) {
  SecureMessaging sm1(kSesAuthEncKey, kSesAuthMacKey, kTI);
  SecureMessaging sm2(kSesAuthEncKey, kSesAuthMacKey, kTI);

  std::array<std::byte, 16> iv1{};
  std::array<std::byte, 16> iv2{};

  ASSERT_EQ(sm1.CalculateIVCmd(iv1), pw::OkStatus());
  ASSERT_EQ(sm2.CalculateIVCmd(iv2), pw::OkStatus());

  // Same inputs should produce same IV
  EXPECT_EQ(std::memcmp(iv1.data(), iv2.data(), 16), 0);
}

// ============================================================================
// CMACt Tests
// ============================================================================

TEST(SecureMessagingTest, CalculateCMACt_Produces8Bytes) {
  SecureMessaging sm(kSesAuthEncKey, kSesAuthMacKey, kTI);

  constexpr auto kData = pw::bytes::Array<
      0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08>();

  std::array<std::byte, 8> cmac_t{};
  ASSERT_EQ(sm.CalculateCMACt(kData, cmac_t), pw::OkStatus());

  // Should be non-zero
  bool all_zero = true;
  for (auto b : cmac_t) {
    if (b != std::byte{0}) {
      all_zero = false;
      break;
    }
  }
  EXPECT_FALSE(all_zero);
}

TEST(SecureMessagingTest, CalculateCMACt_Deterministic) {
  SecureMessaging sm(kSesAuthEncKey, kSesAuthMacKey, kTI);

  constexpr auto kData = pw::bytes::Array<0x11, 0x22, 0x33, 0x44>();

  std::array<std::byte, 8> cmac1{};
  std::array<std::byte, 8> cmac2{};

  ASSERT_EQ(sm.CalculateCMACt(kData, cmac1), pw::OkStatus());
  ASSERT_EQ(sm.CalculateCMACt(kData, cmac2), pw::OkStatus());

  EXPECT_EQ(std::memcmp(cmac1.data(), cmac2.data(), 8), 0);
}

TEST(SecureMessagingTest, CalculateCMACt_DifferentDataDifferentResult) {
  SecureMessaging sm(kSesAuthEncKey, kSesAuthMacKey, kTI);

  constexpr auto kData1 = pw::bytes::Array<0x11, 0x22, 0x33, 0x44>();
  constexpr auto kData2 = pw::bytes::Array<0x11, 0x22, 0x33, 0x45>();

  std::array<std::byte, 8> cmac1{};
  std::array<std::byte, 8> cmac2{};

  ASSERT_EQ(sm.CalculateCMACt(kData1, cmac1), pw::OkStatus());
  ASSERT_EQ(sm.CalculateCMACt(kData2, cmac2), pw::OkStatus());

  EXPECT_NE(std::memcmp(cmac1.data(), cmac2.data(), 8), 0);
}

// ============================================================================
// Command CMAC Tests
// ============================================================================

TEST(SecureMessagingTest, BuildCommandCMAC_Basic) {
  SecureMessaging sm(kSesAuthEncKey, kSesAuthMacKey, kTI);

  constexpr uint8_t kCmd = 0x51;  // GetCardUID
  std::array<std::byte, 8> cmac_t{};

  ASSERT_EQ(sm.BuildCommandCMAC(kCmd, {}, cmac_t), pw::OkStatus());

  // Should produce non-zero CMAC
  bool all_zero = true;
  for (auto b : cmac_t) {
    if (b != std::byte{0}) {
      all_zero = false;
      break;
    }
  }
  EXPECT_FALSE(all_zero);
}

TEST(SecureMessagingTest, BuildCommandCMAC_WithHeader) {
  SecureMessaging sm(kSesAuthEncKey, kSesAuthMacKey, kTI);

  constexpr uint8_t kCmd = 0xAD;  // ReadData
  // CmdHeader: FileNo=2, Offset=0, Length=16
  constexpr auto kCmdHeader = pw::bytes::Array<
      0x02, 0x00, 0x00, 0x00, 0x10, 0x00, 0x00>();

  std::array<std::byte, 8> cmac_t{};
  ASSERT_EQ(sm.BuildCommandCMAC(kCmd, kCmdHeader, cmac_t), pw::OkStatus());

  // Should produce non-zero CMAC
  bool all_zero = true;
  for (auto b : cmac_t) {
    if (b != std::byte{0}) {
      all_zero = false;
      break;
    }
  }
  EXPECT_FALSE(all_zero);
}

TEST(SecureMessagingTest, BuildCommandCMAC_ChangesWithCounter) {
  SecureMessaging sm(kSesAuthEncKey, kSesAuthMacKey, kTI);

  constexpr uint8_t kCmd = 0x51;

  std::array<std::byte, 8> cmac1{};
  ASSERT_EQ(sm.BuildCommandCMAC(kCmd, {}, cmac1), pw::OkStatus());

  sm.IncrementCounter();

  std::array<std::byte, 8> cmac2{};
  ASSERT_EQ(sm.BuildCommandCMAC(kCmd, {}, cmac2), pw::OkStatus());

  // CMAC should change with counter
  EXPECT_NE(std::memcmp(cmac1.data(), cmac2.data(), 8), 0);
}

// ============================================================================
// Response CMAC Verification Tests
// ============================================================================

TEST(SecureMessagingTest, VerifyResponseCMAC_RoundTrip) {
  SecureMessaging sm(kSesAuthEncKey, kSesAuthMacKey, kTI);

  // Build a command CMAC, then simulate response verification
  constexpr uint8_t kResponseCode = 0x00;  // Success

  // Compute expected CMAC for response
  // Input: ResponseCode || CmdCtr || TI
  std::array<std::byte, 7> response_input{};
  response_input[0] = std::byte{kResponseCode};
  response_input[1] = std::byte{0x00};  // CmdCtr low byte
  response_input[2] = std::byte{0x00};  // CmdCtr high byte
  response_input[3] = std::byte{0x12};  // TI[0]
  response_input[4] = std::byte{0x34};  // TI[1]
  response_input[5] = std::byte{0x56};  // TI[2]
  response_input[6] = std::byte{0x78};  // TI[3]

  std::array<std::byte, 8> expected_cmac_t{};
  ASSERT_EQ(sm.CalculateCMACt(response_input, expected_cmac_t), pw::OkStatus());

  // Verification should succeed
  EXPECT_EQ(sm.VerifyResponseCMAC(kResponseCode, expected_cmac_t),
            pw::OkStatus());
}

TEST(SecureMessagingTest, VerifyResponseCMAC_WrongMac) {
  SecureMessaging sm(kSesAuthEncKey, kSesAuthMacKey, kTI);

  constexpr uint8_t kResponseCode = 0x00;
  constexpr auto kWrongCmac = pw::bytes::Array<
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00>();

  EXPECT_EQ(sm.VerifyResponseCMAC(kResponseCode, kWrongCmac),
            pw::Status::Unauthenticated());
}

TEST(SecureMessagingTest, VerifyResponseCMAC_WrongSize) {
  SecureMessaging sm(kSesAuthEncKey, kSesAuthMacKey, kTI);

  constexpr uint8_t kResponseCode = 0x00;
  constexpr auto kShortCmac = pw::bytes::Array<0x00, 0x00, 0x00, 0x00>();

  EXPECT_EQ(sm.VerifyResponseCMAC(kResponseCode, kShortCmac),
            pw::Status::InvalidArgument());
}

// ============================================================================
// Encryption/Decryption Tests
// ============================================================================
//
// Note: EncryptCommandData uses IVCmd, DecryptResponseData uses IVResp.
// These are designed for opposite directions in the protocol:
// - Command: PCD encrypts with IVCmd, tag decrypts with IVCmd
// - Response: Tag encrypts with IVResp, PCD decrypts with IVResp
//
// Therefore we test each direction's properties separately rather than
// doing a simple round-trip.

TEST(SecureMessagingTest, EncryptCommandData_ProducesPaddedCiphertext) {
  SecureMessaging sm(kSesAuthEncKey, kSesAuthMacKey, kTI);

  constexpr auto kPlaintext = pw::bytes::Array<
      0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07>();

  std::array<std::byte, 32> ciphertext{};
  size_t ciphertext_len = 0;

  ASSERT_EQ(sm.EncryptCommandData(kPlaintext, ciphertext, ciphertext_len),
            pw::OkStatus());

  // Ciphertext should be 16 bytes (7 bytes + padding rounded to 16)
  EXPECT_EQ(ciphertext_len, 16u);

  // Ciphertext should differ from plaintext
  EXPECT_NE(std::memcmp(ciphertext.data(), kPlaintext.data(),
                        std::min(ciphertext_len, kPlaintext.size())), 0);
}

TEST(SecureMessagingTest, EncryptCommandData_EmptyData) {
  SecureMessaging sm(kSesAuthEncKey, kSesAuthMacKey, kTI);

  std::array<std::byte, 32> ciphertext{};
  size_t ciphertext_len = 0;

  ASSERT_EQ(sm.EncryptCommandData({}, ciphertext, ciphertext_len),
            pw::OkStatus());

  // Even empty data needs padding (16 bytes for 0x80 + 15 zeros)
  EXPECT_EQ(ciphertext_len, 16u);
}

TEST(SecureMessagingTest, EncryptCommandData_16ByteData) {
  SecureMessaging sm(kSesAuthEncKey, kSesAuthMacKey, kTI);

  constexpr auto kPlaintext = pw::bytes::Array<
      0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
      0x08, 0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x0E, 0x0F>();

  std::array<std::byte, 48> ciphertext{};
  size_t ciphertext_len = 0;

  ASSERT_EQ(sm.EncryptCommandData(kPlaintext, ciphertext, ciphertext_len),
            pw::OkStatus());

  // 16 bytes of data + padding = 32 bytes
  EXPECT_EQ(ciphertext_len, 32u);
}

TEST(SecureMessagingTest, EncryptCommandData_Deterministic) {
  SecureMessaging sm1(kSesAuthEncKey, kSesAuthMacKey, kTI);
  SecureMessaging sm2(kSesAuthEncKey, kSesAuthMacKey, kTI);

  constexpr auto kPlaintext = pw::bytes::Array<0x01, 0x02, 0x03, 0x04>();

  std::array<std::byte, 32> ct1{};
  std::array<std::byte, 32> ct2{};
  size_t len1 = 0, len2 = 0;

  ASSERT_EQ(sm1.EncryptCommandData(kPlaintext, ct1, len1), pw::OkStatus());
  ASSERT_EQ(sm2.EncryptCommandData(kPlaintext, ct2, len2), pw::OkStatus());

  EXPECT_EQ(len1, len2);
  EXPECT_EQ(std::memcmp(ct1.data(), ct2.data(), len1), 0);
}

TEST(SecureMessagingTest, EncryptCommandData_ChangesWithCounter) {
  SecureMessaging sm(kSesAuthEncKey, kSesAuthMacKey, kTI);

  constexpr auto kPlaintext = pw::bytes::Array<0x01, 0x02, 0x03, 0x04>();

  std::array<std::byte, 32> ct1{};
  size_t len1 = 0;
  ASSERT_EQ(sm.EncryptCommandData(kPlaintext, ct1, len1), pw::OkStatus());

  sm.IncrementCounter();

  std::array<std::byte, 32> ct2{};
  size_t len2 = 0;
  ASSERT_EQ(sm.EncryptCommandData(kPlaintext, ct2, len2), pw::OkStatus());

  // Ciphertext should change because IV changes with counter
  EXPECT_NE(std::memcmp(ct1.data(), ct2.data(), len1), 0);
}

TEST(SecureMessagingTest, Decrypt_InvalidCiphertextLength) {
  SecureMessaging sm(kSesAuthEncKey, kSesAuthMacKey, kTI);

  // Ciphertext must be multiple of 16
  constexpr auto kInvalidCiphertext = pw::bytes::Array<
      0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
      0x08, 0x09, 0x0A>();  // 11 bytes

  std::array<std::byte, 32> decrypted{};
  size_t decrypted_len = 0;

  EXPECT_EQ(sm.DecryptResponseData(kInvalidCiphertext, decrypted, decrypted_len),
            pw::Status::InvalidArgument());
}

}  // namespace
}  // namespace maco::nfc
