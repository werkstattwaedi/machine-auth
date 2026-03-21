// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

/// @file sdm_constants.h
/// @brief NTAG424 DNA NDEF template and SDM configuration for tag checkout.
///
/// URL: https://<sdm_base_url>?picc=<encrypted>&cmac=<signature>
/// Example: https://id.werkstattwaedi.ch/?picc=...&cmac=...
///
/// The NDEF file (file 0x02) contains a URI record with placeholder bytes
/// that the tag replaces with encrypted UID+counter and CMAC when tapped
/// by an NFC phone (Secure Dynamic Messaging).
///
/// The base URL is deployment-specific, passed via PersonalizeTagRequest.
///
/// See ADR-0017 for the full security architecture and key assignments.

#include <array>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <string_view>

#include "pw_bytes/span.h"
#include "pw_result/result.h"
#include "pw_span/span.h"

namespace maco::personalize::sdm {

/// NDEF file number on NTAG424 DNA.
constexpr uint8_t kNdefFileNumber = 0x02;

/// Maximum bytes per plain-mode WriteData (limited by single frame).
constexpr size_t kWriteChunkSize = 44;

/// Maximum supported base URL length (leaves room for NDEF overhead + SDM
/// placeholders within 256-byte NDEF file limit).
constexpr size_t kMaxBaseUrlLength = 64;

// Fixed parts of the URL after the base URL:
//   "?picc=" (6) + 32 hex zeros + "&cmac=" (6) + 16 hex zeros = 60 bytes
constexpr size_t kUrlSuffixLength = 6 + 32 + 6 + 16;  // 60

// NDEF overhead: NLEN(2) + header(3) + payload_length(1) + type(1) +
// URI prefix code(1) = 7
constexpr size_t kNdefOverhead = 7;

/// Maximum total NDEF file size.
constexpr size_t kMaxNdefSize = kNdefOverhead + kMaxBaseUrlLength +
                                kUrlSuffixLength;

/// Result of building an NDEF template from a base URL.
struct NdefTemplate {
  std::array<std::byte, kMaxNdefSize> data;
  size_t size;

  /// Offset of the PICC data placeholder within the NDEF file.
  uint8_t picc_data_offset;
  /// Offset of the CMAC placeholder within the NDEF file.
  uint8_t sdm_mac_offset;
};

/// Build an NDEF URI record template for the given base URL.
///
/// @param base_url The URL part after "https://", e.g. "id.werkstattwaedi.ch/"
/// @return NdefTemplate with the complete NDEF file content, or error if URL
///         is too long.
///
/// Layout:
///   [0x00-0x01] NLEN (big-endian, total NDEF message length)
///   [0x02]      0xD1 (NDEF header: MB+ME, SR, TNF=Well-Known)
///   [0x03]      0x01 (Type Length)
///   [0x04]      Payload Length
///   [0x05]      0x55 (Type = 'U' URI)
///   [0x06]      0x04 (URI prefix = "https://")
///   [0x07-...]  base_url + "?picc=" + 32 zeros + "&cmac=" + 16 zeros
inline pw::Result<NdefTemplate> BuildNdefTemplate(std::string_view base_url) {
  if (base_url.empty() || base_url.size() > kMaxBaseUrlLength) {
    return pw::Status::InvalidArgument();
  }

  const size_t url_total = base_url.size() + kUrlSuffixLength;
  // Payload = URI prefix code (1) + url_total
  const size_t payload_length = 1 + url_total;
  // NDEF message = header(3) + payload_length(1) + type(1) + payload
  const size_t ndef_message_length = 3 + payload_length;
  // Total file = NLEN(2) + NDEF message
  const size_t total_size = 2 + ndef_message_length;

  if (payload_length > 255) {
    return pw::Status::InvalidArgument();  // SR (Short Record) limit
  }

  NdefTemplate result{};
  result.size = total_size;
  size_t pos = 0;

  auto put = [&](uint8_t byte) {
    result.data[pos++] = std::byte{byte};
  };
  auto put_str = [&](std::string_view s) {
    for (char c : s) {
      result.data[pos++] = std::byte(static_cast<uint8_t>(c));
    }
  };
  auto put_zeros = [&](size_t count) {
    for (size_t i = 0; i < count; ++i) {
      result.data[pos++] = std::byte{'0'};
    }
  };

  // NLEN (2 bytes, big-endian)
  put(static_cast<uint8_t>((ndef_message_length >> 8) & 0xFF));
  put(static_cast<uint8_t>(ndef_message_length & 0xFF));

  // NDEF record header
  put(0xD1);  // MB+ME, SR, TNF=Well-Known
  put(0x01);  // Type Length
  put(static_cast<uint8_t>(payload_length));  // Payload Length
  put(0x55);  // Type 'U' (URI)
  put(0x04);  // URI prefix "https://"

  // Base URL
  put_str(base_url);

  // "?picc="
  put_str("?picc=");

  // PICC placeholder: 32 hex zeros (16 encrypted bytes)
  result.picc_data_offset = static_cast<uint8_t>(pos);
  put_zeros(32);

  // "&cmac="
  put_str("&cmac=");

  // CMAC placeholder: 16 hex zeros (8 CMAC bytes)
  result.sdm_mac_offset = static_cast<uint8_t>(pos);
  put_zeros(16);

  return result;
}

/// Build ChangeFileSettings payload for enabling SDM with the given offsets.
///
/// 15 bytes:
///   [0]     FileOption: 0x40 (SDM enabled, CommMode Plain)
///   [1-2]   AccessRights: Read=Eh(free), Write=0h(Key0), RW=Eh(free),
///           Change=0h(Key0)
///   [3]     SDMOptions: 0xC1 (ASCII + SDMReadCtr + UID)
///   [4-5]   SDMAccessRights: MetaRead=1(Key1), FileRead=3(Key3),
///           RFU=Fh, CtrRet=Eh(free)
///   [6-8]   PICCDataOffset (LE 24-bit)
///   [9-11]  SDMMACInputOffset (LE 24-bit) — same as PICCDataOffset
///   [12-14] SDMMACOffset (LE 24-bit)
inline std::array<std::byte, 15> BuildSdmFileSettings(
    uint8_t picc_data_offset, uint8_t sdm_mac_offset) {
  // clang-format off
  return {{
      std::byte{0x40},  // FileOption: SDM + Plain
      std::byte{0xE0},  // AccessRights[0]: Read=Eh, Write=0h
      std::byte{0xE0},  // AccessRights[1]: RW=Eh, Change=0h
      std::byte{0xC1},  // SDMOptions: ASCII | SDMReadCtr | UID
      std::byte{0xFE},  // SDMAccessRights low byte: RFU=Fh, CtrRet=Eh
      std::byte{0x13},  // SDMAccessRights high byte: MetaRead=1, FileRead=3
      // PICCDataOffset (LE 24-bit)
      std::byte{picc_data_offset}, std::byte{0x00}, std::byte{0x00},
      // SDMMACInputOffset (LE 24-bit) — same as PICCDataOffset
      std::byte{picc_data_offset}, std::byte{0x00}, std::byte{0x00},
      // SDMMACOffset (LE 24-bit)
      std::byte{sdm_mac_offset}, std::byte{0x00}, std::byte{0x00},
  }};
  // clang-format on
}

/// Check if GetFileSettings response has SDM enabled with matching offsets.
///
/// GetFileSettings response layout (19 bytes when SDM enabled):
///   [0]    FileType
///   [1]    FileOption
///   [2-3]  AccessRights
///   [4-6]  FileSize (3 bytes)
///   [7]    SDMOptions
///   [8-9]  SDMAccessRights
///   [10-12] PICCDataOffset
///   [13-15] SDMMACInputOffset
///   [16-18] SDMMACOffset
inline bool IsSdmConfigured(pw::ConstByteSpan settings,
                            uint8_t expected_picc_offset,
                            uint8_t expected_mac_offset) {
  if (settings.size() < 19) {
    return false;
  }

  auto expected = BuildSdmFileSettings(expected_picc_offset,
                                       expected_mac_offset);

  // FileOption + AccessRights: expected[0-2] → response[1-3]
  for (size_t i = 0; i < 3; ++i) {
    if (settings[1 + i] != expected[i]) {
      return false;
    }
  }

  // SDMOptions + SDMAccessRights + offsets: expected[3-14] → response[7-18]
  for (size_t i = 3; i < expected.size(); ++i) {
    if (settings[i + 4] != expected[i]) {
      return false;
    }
  }

  return true;
}

}  // namespace maco::personalize::sdm
