// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/apps/personalize/sdm_constants.h"

#include <cstddef>
#include <cstdint>
#include <string>
#include <string_view>

#include "pw_unit_test/framework.h"

namespace maco::personalize::sdm {
namespace {

constexpr std::string_view kBaseUrl = "id.werkstattwaedi.ch/";

uint8_t Byte(const NdefTemplate& t, size_t i) {
  return std::to_integer<uint8_t>(t.data[i]);
}

// Regression: the NDEF short-record header is 4 bytes (flags, type-length,
// payload-length, type). A prior off-by-one counted 3, so NLEN under-reported
// by one and the record was malformed — Android tap-to-open, Chrome Web NFC,
// and TagInfo's NDEF parser all rejected it ("No NDEF Data Storage Populated").
TEST(BuildNdefTemplate, NlenAndSizeMatchTheRecordLength) {
  auto result = BuildNdefTemplate(kBaseUrl);
  ASSERT_TRUE(result.ok());
  const NdefTemplate& t = *result;

  // payload = prefix(1) + base_url + "?picc="(6) + 32 + "&cmac="(6) + 16
  const size_t payload_length = 1 + kBaseUrl.size() + kUrlSuffixLength;
  const size_t expected_message_length = 4 + payload_length;

  // NLEN (bytes 0-1, big-endian) must equal the record length.
  const size_t nlen = (static_cast<size_t>(Byte(t, 0)) << 8) | Byte(t, 1);
  EXPECT_EQ(nlen, expected_message_length);

  // Total file = NLEN(2) + message; nothing truncated.
  EXPECT_EQ(t.size, 2 + expected_message_length);
}

TEST(BuildNdefTemplate, RecordHeaderIsAWellKnownUriShortRecord) {
  auto result = BuildNdefTemplate(kBaseUrl);
  ASSERT_TRUE(result.ok());
  const NdefTemplate& t = *result;

  const size_t payload_length = 1 + kBaseUrl.size() + kUrlSuffixLength;

  EXPECT_EQ(Byte(t, 2), 0xD1);                                 // flags MB+ME+SR
  EXPECT_EQ(Byte(t, 3), 0x01);                                 // type length
  EXPECT_EQ(Byte(t, 4), static_cast<uint8_t>(payload_length)); // SR payload len
  EXPECT_EQ(Byte(t, 5), 0x55);                                 // 'U'
  EXPECT_EQ(Byte(t, 6), 0x04);                                 // "https://"
}

// The final byte of the file must be the last char of the 16-char CMAC
// placeholder — i.e. the write isn't cut short by the length off-by-one.
TEST(BuildNdefTemplate, FullMessageIncludingFinalCmacByteFits) {
  auto result = BuildNdefTemplate(kBaseUrl);
  ASSERT_TRUE(result.ok());
  const NdefTemplate& t = *result;
  EXPECT_EQ(Byte(t, t.size - 1), static_cast<uint8_t>('0'));
}

TEST(BuildNdefTemplate, PlaceholderOffsetsPointAtZeros) {
  auto result = BuildNdefTemplate(kBaseUrl);
  ASSERT_TRUE(result.ok());
  const NdefTemplate& t = *result;

  // Layout: NLEN(2) D1 01 plen 55 04 <base_url> "?picc=" <32×'0'> "&cmac=" <16×'0'>
  const size_t picc = 2 + 5 + kBaseUrl.size() + 6;
  EXPECT_EQ(t.picc_data_offset, picc);
  EXPECT_EQ(Byte(t, t.picc_data_offset), static_cast<uint8_t>('0'));

  EXPECT_EQ(t.sdm_mac_offset, picc + 32 + 6);
  EXPECT_EQ(Byte(t, t.sdm_mac_offset), static_cast<uint8_t>('0'));
}

TEST(BuildNdefTemplate, RejectsEmptyAndOverlongBaseUrl) {
  EXPECT_FALSE(BuildNdefTemplate("").ok());
  const std::string too_long(kMaxBaseUrlLength + 1, 'x');
  EXPECT_FALSE(BuildNdefTemplate(too_long).ok());
}

TEST(NdefContentMatches, AcceptsIdenticalContent) {
  auto result = BuildNdefTemplate(kBaseUrl);
  ASSERT_TRUE(result.ok());
  EXPECT_TRUE(NdefContentMatches(result->content(), *result));
}

// With SDM enabled the tag substitutes the PICC/CMAC mirror regions at read
// time, so differences there must not fail verification.
TEST(NdefContentMatches, IgnoresBothSdmMirrorRegions) {
  auto result = BuildNdefTemplate(kBaseUrl);
  ASSERT_TRUE(result.ok());
  NdefTemplate read_back = *result;

  for (size_t i = 0; i < kPiccDataHexLength; ++i) {
    read_back.data[result->picc_data_offset + i] = std::byte{'A'};
  }
  for (size_t i = 0; i < kSdmMacHexLength; ++i) {
    read_back.data[result->sdm_mac_offset + i] = std::byte{'F'};
  }

  EXPECT_TRUE(NdefContentMatches(read_back.content(), *result));
}

TEST(NdefContentMatches, RejectsDifferenceOutsideMirrorRegions) {
  auto result = BuildNdefTemplate(kBaseUrl);
  ASSERT_TRUE(result.ok());

  // Corrupt one byte of the base URL (just after the 7-byte NDEF overhead).
  NdefTemplate read_back = *result;
  read_back.data[kNdefOverhead] = std::byte{'x'};
  EXPECT_FALSE(NdefContentMatches(read_back.content(), *result));

  // A byte between the mirror regions ("&cmac=" separator) must also count.
  NdefTemplate read_back2 = *result;
  read_back2.data[result->picc_data_offset + kPiccDataHexLength] =
      std::byte{'#'};
  EXPECT_FALSE(NdefContentMatches(read_back2.content(), *result));
}

TEST(NdefContentMatches, RejectsSizeMismatch) {
  auto result = BuildNdefTemplate(kBaseUrl);
  ASSERT_TRUE(result.ok());
  EXPECT_FALSE(NdefContentMatches(
      pw::ConstByteSpan(result->data.data(), result->size - 1), *result));
}

}  // namespace
}  // namespace maco::personalize::sdm
