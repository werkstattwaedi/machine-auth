// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/devices/pn532/pn532_command.h"

#include <array>

#include "maco_firmware/devices/pn532/pn532_constants.h"
#include "pw_bytes/array.h"
#include "pw_unit_test/framework.h"

namespace maco::nfc {
namespace {

using namespace pn532;

// ============================================================================
// Checksum Helper Tests
// ============================================================================

TEST(Pn532CommandTest, CalculateLengthChecksum_ReturnsOnesComplement) {
  // LEN + LCS should equal 0 (mod 256)
  EXPECT_EQ(Pn532Command::CalculateLengthChecksum(0x00), 0x00);
  EXPECT_EQ(Pn532Command::CalculateLengthChecksum(0x01), 0xFF);
  EXPECT_EQ(Pn532Command::CalculateLengthChecksum(0x02), 0xFE);
  EXPECT_EQ(Pn532Command::CalculateLengthChecksum(0x05), 0xFB);
  EXPECT_EQ(Pn532Command::CalculateLengthChecksum(0xFF), 0x01);
}

TEST(Pn532CommandTest, ValidateLengthChecksum_AcceptsValidPairs) {
  EXPECT_TRUE(Pn532Command::ValidateLengthChecksum(0x00, 0x00));
  EXPECT_TRUE(Pn532Command::ValidateLengthChecksum(0x01, 0xFF));
  EXPECT_TRUE(Pn532Command::ValidateLengthChecksum(0x02, 0xFE));
  EXPECT_TRUE(Pn532Command::ValidateLengthChecksum(0x05, 0xFB));
  EXPECT_TRUE(Pn532Command::ValidateLengthChecksum(0xFF, 0x01));
}

TEST(Pn532CommandTest, ValidateLengthChecksum_RejectsInvalidPairs) {
  EXPECT_FALSE(Pn532Command::ValidateLengthChecksum(0x01, 0x00));
  EXPECT_FALSE(Pn532Command::ValidateLengthChecksum(0x05, 0x00));
  EXPECT_FALSE(Pn532Command::ValidateLengthChecksum(0x02, 0xFF));
}

TEST(Pn532CommandTest, CalculateDataChecksum_ReturnsOnesComplementOfSum) {
  // Single byte
  auto data1 = pw::bytes::Array<0xD4>();
  uint8_t dcs1 = Pn532Command::CalculateDataChecksum(data1);
  EXPECT_EQ((0xD4 + dcs1) & 0xFF, 0);

  // Multiple bytes: TFI(0xD4) + CMD(0x14) = 0xE8
  auto data2 = pw::bytes::Array<0xD4, 0x14>();
  uint8_t dcs2 = Pn532Command::CalculateDataChecksum(data2);
  EXPECT_EQ((0xD4 + 0x14 + dcs2) & 0xFF, 0);

  // SAMConfiguration command: TFI(0xD4) + CMD(0x14) + params(0x01, 0x14, 0x01)
  auto data3 = pw::bytes::Array<0xD4, 0x14, 0x01, 0x14, 0x01>();
  uint8_t dcs3 = Pn532Command::CalculateDataChecksum(data3);
  EXPECT_EQ((0xD4 + 0x14 + 0x01 + 0x14 + 0x01 + dcs3) & 0xFF, 0);
}

TEST(Pn532CommandTest, ValidateDataChecksum_AcceptsValid) {
  // TFI + CMD data with correct checksum
  auto data = pw::bytes::Array<0xD4, 0x14, 0x01, 0x14, 0x01>();
  uint8_t dcs = Pn532Command::CalculateDataChecksum(data);
  EXPECT_TRUE(Pn532Command::ValidateDataChecksum(data, dcs));
}

TEST(Pn532CommandTest, ValidateDataChecksum_RejectsInvalid) {
  auto data = pw::bytes::Array<0xD4, 0x14>();
  EXPECT_FALSE(Pn532Command::ValidateDataChecksum(data, 0x00));
  EXPECT_FALSE(Pn532Command::ValidateDataChecksum(data, 0xFF));
}

// ============================================================================
// BuildFrame Tests
// ============================================================================

TEST(Pn532CommandTest, BuildFrame_NoParams_BuildsCorrectFrame) {
  // GetFirmwareVersion command (no params)
  Pn532Command cmd{.command = kCmdGetFirmwareVersion, .params = {}};

  std::array<std::byte, 32> buffer{};
  size_t len = cmd.BuildFrame(buffer);

  // Frame: [0x00][0x00 0xFF][LEN=2][LCS][TFI=0xD4][CMD=0x02][DCS][0x00]
  ASSERT_EQ(len, 9u);

  // Preamble and start code
  EXPECT_EQ(buffer[0], std::byte{0x00});
  EXPECT_EQ(buffer[1], std::byte{0x00});
  EXPECT_EQ(buffer[2], std::byte{0xFF});

  // LEN = 2 (TFI + CMD)
  EXPECT_EQ(buffer[3], std::byte{0x02});
  // LCS = ~0x02 + 1 = 0xFE
  EXPECT_EQ(buffer[4], std::byte{0xFE});

  // TFI and command
  EXPECT_EQ(buffer[5], kTfiHostToPn532);
  EXPECT_EQ(buffer[6], std::byte{kCmdGetFirmwareVersion});

  // DCS: ~(0xD4 + 0x02) + 1 = ~0xD6 + 1 = 0x29 + 1 = 0x2A
  EXPECT_EQ(buffer[7], std::byte{0x2A});

  // Postamble
  EXPECT_EQ(buffer[8], std::byte{0x00});
}

TEST(Pn532CommandTest, BuildFrame_WithParams_BuildsCorrectFrame) {
  // InListPassiveTarget: MaxTg=1, BrTy=0x00 (106kbps Type A)
  auto params = pw::bytes::Array<0x01, 0x00>();
  Pn532Command cmd{.command = kCmdInListPassiveTarget, .params = params};

  std::array<std::byte, 32> buffer{};
  size_t len = cmd.BuildFrame(buffer);

  // Frame: [0x00][0x00 0xFF][LEN=4][LCS][TFI][CMD][0x01][0x00][DCS][0x00]
  ASSERT_EQ(len, 11u);

  // LEN = 4 (TFI + CMD + 2 params)
  EXPECT_EQ(buffer[3], std::byte{0x04});
  // LCS = ~0x04 + 1 = 0xFC
  EXPECT_EQ(buffer[4], std::byte{0xFC});

  // TFI and command
  EXPECT_EQ(buffer[5], kTfiHostToPn532);
  EXPECT_EQ(buffer[6], std::byte{kCmdInListPassiveTarget});

  // Params
  EXPECT_EQ(buffer[7], std::byte{0x01});
  EXPECT_EQ(buffer[8], std::byte{0x00});

  // Verify DCS (sum wraps at 8 bits)
  uint8_t sum = static_cast<uint8_t>(0xD4 + kCmdInListPassiveTarget + 0x01 + 0x00);
  uint8_t expected_dcs = static_cast<uint8_t>(~sum + 1);
  EXPECT_EQ(buffer[9], std::byte{expected_dcs});

  // Postamble
  EXPECT_EQ(buffer[10], std::byte{0x00});
}

TEST(Pn532CommandTest, BuildFrame_BufferTooSmall_ReturnsZero) {
  auto params = pw::bytes::Array<0x01, 0x00>();
  Pn532Command cmd{.command = kCmdInListPassiveTarget, .params = params};

  // Need 11 bytes, provide only 10
  std::array<std::byte, 10> small_buffer{};
  size_t len = cmd.BuildFrame(small_buffer);

  EXPECT_EQ(len, 0u);
}

TEST(Pn532CommandTest, BuildFrame_ParamsTooLarge_ReturnsZero) {
  // Create params larger than max frame length
  std::array<std::byte, 256> large_params{};
  Pn532Command cmd{.command = 0x00,
                   .params = pw::ConstByteSpan(large_params)};

  std::array<std::byte, 300> buffer{};
  size_t len = cmd.BuildFrame(buffer);

  EXPECT_EQ(len, 0u);
}

TEST(Pn532CommandTest, BuildFrame_SamConfiguration_MatchesExpected) {
  // SAMConfiguration: Mode=1, Timeout=0x14, IRQ=1
  auto params = pw::bytes::Array<0x01, 0x14, 0x01>();
  Pn532Command cmd{.command = kCmdSamConfiguration, .params = params};

  std::array<std::byte, 32> buffer{};
  size_t len = cmd.BuildFrame(buffer);

  // Expected frame from PN532 datasheet
  // 00 00 FF 05 FB D4 14 01 14 01 02 00
  ASSERT_EQ(len, 12u);

  EXPECT_EQ(buffer[0], std::byte{0x00});  // Preamble
  EXPECT_EQ(buffer[1], std::byte{0x00});  // Start code
  EXPECT_EQ(buffer[2], std::byte{0xFF});
  EXPECT_EQ(buffer[3], std::byte{0x05});  // LEN
  EXPECT_EQ(buffer[4], std::byte{0xFB});  // LCS
  EXPECT_EQ(buffer[5], std::byte{0xD4});  // TFI
  EXPECT_EQ(buffer[6], std::byte{0x14});  // CMD
  EXPECT_EQ(buffer[7], std::byte{0x01});  // Mode
  EXPECT_EQ(buffer[8], std::byte{0x14});  // Timeout
  EXPECT_EQ(buffer[9], std::byte{0x01});  // IRQ
  EXPECT_EQ(buffer[10], std::byte{0x02}); // DCS
  EXPECT_EQ(buffer[11], std::byte{0x00}); // Postamble
}

// ============================================================================
// ParseResponse Tests
// ============================================================================

TEST(Pn532CommandTest, ParseResponse_ValidResponse_ReturnsPayload) {
  // GetFirmwareVersion response: IC=0x32, Ver=1.6, Support=7
  // Frame: [00][00 FF][06][FA][D5][03][32][01][06][07][E8][00]
  auto frame = pw::bytes::Array<0x00, 0x00, 0xFF, 0x06, 0xFA, 0xD5, 0x03, 0x32,
                                0x01, 0x06, 0x07, 0xE8, 0x00>();

  auto result = Pn532Command::ParseResponse(kCmdGetFirmwareVersion, frame);

  ASSERT_TRUE(result.ok());
  ASSERT_EQ(result.value().size(), 4u);
  EXPECT_EQ(result.value()[0], std::byte{0x32});  // IC
  EXPECT_EQ(result.value()[1], std::byte{0x01});  // Version major
  EXPECT_EQ(result.value()[2], std::byte{0x06});  // Version minor
  EXPECT_EQ(result.value()[3], std::byte{0x07});  // Support
}

TEST(Pn532CommandTest, ParseResponse_NoPayload_ReturnsEmptySpan) {
  // SAMConfiguration response (no payload, just ACK)
  // Frame: [00][00 FF][02][FE][D5][15][16][00]
  auto frame = pw::bytes::Array<0x00, 0x00, 0xFF, 0x02, 0xFE, 0xD5, 0x15, 0x16,
                                0x00>();

  auto result = Pn532Command::ParseResponse(kCmdSamConfiguration, frame);

  ASSERT_TRUE(result.ok());
  EXPECT_EQ(result.value().size(), 0u);
}

TEST(Pn532CommandTest, ParseResponse_WithPreamble_FindsStartSequence) {
  // Response with extra preamble bytes
  // [00][00][00 FF][02][FE][D5][15][16][00]
  auto frame = pw::bytes::Array<0x00, 0x00, 0x00, 0xFF, 0x02, 0xFE, 0xD5, 0x15,
                                0x16, 0x00>();

  auto result = Pn532Command::ParseResponse(kCmdSamConfiguration, frame);

  ASSERT_TRUE(result.ok());
  EXPECT_EQ(result.value().size(), 0u);
}

TEST(Pn532CommandTest, ParseResponse_NoStartSequence_ReturnsDataLoss) {
  // Garbage data with no 00 FF start sequence
  auto frame = pw::bytes::Array<0x01, 0x02, 0x03, 0x04, 0x05>();

  auto result = Pn532Command::ParseResponse(kCmdGetFirmwareVersion, frame);

  EXPECT_TRUE(result.status().IsDataLoss());
}

TEST(Pn532CommandTest, ParseResponse_InvalidLengthChecksum_ReturnsDataLoss) {
  // Valid start, but wrong LCS
  // [00][00 FF][06][00][D5][03][32][01][06][07][E8][00]
  //                 ^^ should be FA
  auto frame = pw::bytes::Array<0x00, 0x00, 0xFF, 0x06, 0x00, 0xD5, 0x03, 0x32,
                                0x01, 0x06, 0x07, 0xE8, 0x00>();

  auto result = Pn532Command::ParseResponse(kCmdGetFirmwareVersion, frame);

  EXPECT_TRUE(result.status().IsDataLoss());
}

TEST(Pn532CommandTest, ParseResponse_InvalidDataChecksum_ReturnsDataLoss) {
  // Valid LCS, but wrong DCS
  // [00][00 FF][06][FA][D5][03][32][01][06][07][00][00]
  //                                         ^^ should be E8
  auto frame = pw::bytes::Array<0x00, 0x00, 0xFF, 0x06, 0xFA, 0xD5, 0x03, 0x32,
                                0x01, 0x06, 0x07, 0x00, 0x00>();

  auto result = Pn532Command::ParseResponse(kCmdGetFirmwareVersion, frame);

  EXPECT_TRUE(result.status().IsDataLoss());
}

TEST(Pn532CommandTest, ParseResponse_WrongTfi_ReturnsDataLoss) {
  // Wrong TFI (D4 instead of D5)
  // [00][00 FF][02][FE][D4][15][17][00]
  //                     ^^ should be D5
  auto frame =
      pw::bytes::Array<0x00, 0x00, 0xFF, 0x02, 0xFE, 0xD4, 0x15, 0x17, 0x00>();

  auto result = Pn532Command::ParseResponse(kCmdSamConfiguration, frame);

  EXPECT_TRUE(result.status().IsDataLoss());
}

TEST(Pn532CommandTest, ParseResponse_ErrorTfi_ReturnsInternal) {
  // Error TFI (0x7F)
  // [00][00 FF][02][FE][7F][01][80][00]
  auto frame =
      pw::bytes::Array<0x00, 0x00, 0xFF, 0x02, 0xFE, 0x7F, 0x01, 0x80, 0x00>();

  auto result = Pn532Command::ParseResponse(kCmdGetFirmwareVersion, frame);

  EXPECT_TRUE(result.status().IsInternal());
}

TEST(Pn532CommandTest, ParseResponse_WrongCommand_ReturnsDataLoss) {
  // Response command doesn't match expected + 1
  // [00][00 FF][02][FE][D5][03][28][00] - response is 0x03 but expected 0x15
  auto frame =
      pw::bytes::Array<0x00, 0x00, 0xFF, 0x02, 0xFE, 0xD5, 0x03, 0x28, 0x00>();

  // Sending SAMConfiguration (0x14), expecting response 0x15
  auto result = Pn532Command::ParseResponse(kCmdSamConfiguration, frame);

  EXPECT_TRUE(result.status().IsDataLoss());
}

TEST(Pn532CommandTest, ParseResponse_TruncatedFrame_ReturnsDataLoss) {
  // Frame cut off before complete
  auto frame = pw::bytes::Array<0x00, 0x00, 0xFF, 0x06, 0xFA, 0xD5>();

  auto result = Pn532Command::ParseResponse(kCmdGetFirmwareVersion, frame);

  EXPECT_TRUE(result.status().IsDataLoss());
}

TEST(Pn532CommandTest, ParseResponse_TooShortForLenLcs_ReturnsDataLoss) {
  // Only start sequence, no LEN/LCS
  auto frame = pw::bytes::Array<0x00, 0xFF>();

  auto result = Pn532Command::ParseResponse(kCmdGetFirmwareVersion, frame);

  EXPECT_TRUE(result.status().IsDataLoss());
}

// ============================================================================
// Round-trip Test
// ============================================================================

TEST(Pn532CommandTest, BuildAndParse_RoundTrip) {
  // Build a command frame
  auto params = pw::bytes::Array<0x01, 0x00>();
  Pn532Command cmd{.command = kCmdInListPassiveTarget, .params = params};

  std::array<std::byte, 32> tx_buffer{};
  size_t tx_len = cmd.BuildFrame(tx_buffer);
  ASSERT_GT(tx_len, 0u);

  // Simulate a valid response (InListPassiveTarget response)
  // Response CMD = 0x4B, payload: Tg=1, NbTg, SENS_RES(2), SEL_RES, UID_len, UID(4)
  // LEN = 10 (TFI + CMD + 8 payload bytes)
  // LCS = ~10 + 1 = 0xF6
  // Data: D5 4B 01 00 04 08 04 AA BB CC = sum 866 = 0x362, & 0xFF = 0x62
  // DCS = ~0x62 + 1 = 0x9E
  auto response = pw::bytes::Array<0x00, 0x00, 0xFF, 0x0A, 0xF6, 0xD5, 0x4B,
                                   0x01, 0x00, 0x04, 0x08, 0x04, 0xAA, 0xBB,
                                   0xCC, 0x9E, 0x00>();

  auto result = Pn532Command::ParseResponse(kCmdInListPassiveTarget, response);

  ASSERT_TRUE(result.ok());
  // LEN=0x0A means 10 bytes of data (TFI+CMD+payload)
  // So payload = 10 - 2 = 8 bytes
  EXPECT_EQ(result.value().size(), 8u);
  EXPECT_EQ(result.value()[0], std::byte{0x01});  // Tg
}

}  // namespace
}  // namespace maco::nfc
