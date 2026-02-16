// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

/// @file sdm_constants.h
/// @brief NTAG424 DNA NDEF template and SDM configuration for tag checkout.
///
/// URL: https://werkstattwaedi.ch/tag?picc=<encrypted>&cmac=<signature>
///
/// The NDEF file (file 0x02) contains a URI record with placeholder bytes
/// that the tag replaces with encrypted UID+counter and CMAC when tapped
/// by an NFC phone (Secure Dynamic Messaging).
///
/// See ADR-0017 for the full security architecture and key assignments.

#include <array>
#include <cstddef>
#include <cstdint>

#include "pw_bytes/span.h"

namespace maco::personalize::sdm {

/// NDEF file number on NTAG424 DNA.
constexpr uint8_t kNdefFileNumber = 0x02;

/// Total NDEF file content size (88 bytes, split into 2 writes).
constexpr size_t kNdefTotalSize = 88;

/// Maximum bytes per plain-mode WriteData (limited by single frame).
constexpr size_t kWriteChunkSize = 44;

// ---------------------------------------------------------------------------
// NDEF URL template
// ---------------------------------------------------------------------------
// Layout:
//   [0x00-0x01] NLEN = 0x0056 (86 bytes NDEF message)
//   [0x02]      0xD1 (NDEF header: MB+ME, SR, TNF=Well-Known)
//   [0x03]      0x01 (Type Length)
//   [0x04]      0x52 (Payload Length = 82)
//   [0x05]      0x55 (Type = 'U' URI)
//   [0x06]      0x04 (URI prefix = "https://")
//   [0x07-0x21] "werkstattwaedi.ch/tag?picc=" (27 bytes)
//   [0x22-0x41] PICC placeholder (32 hex zeros = 16 encrypted bytes)
//   [0x42-0x47] "&cmac=" (6 bytes)
//   [0x48-0x57] CMAC placeholder (16 hex zeros = 8 CMAC bytes)

// clang-format off
constexpr std::array<std::byte, kNdefTotalSize> kNdefTemplate = {{
    // NLEN (2 bytes, big-endian)
    std::byte{0x00}, std::byte{0x56},
    // NDEF record header
    std::byte{0xD1},  // MB+ME, SR, TNF=Well-Known
    std::byte{0x01},  // Type Length
    std::byte{0x52},  // Payload Length (82)
    std::byte{0x55},  // Type 'U' (URI)
    std::byte{0x04},  // URI prefix "https://"
    // "werkstattwaedi.ch/tag?picc="
    std::byte{'w'}, std::byte{'e'}, std::byte{'r'}, std::byte{'k'},
    std::byte{'s'}, std::byte{'t'}, std::byte{'a'}, std::byte{'t'},
    std::byte{'t'}, std::byte{'w'}, std::byte{'a'}, std::byte{'e'},
    std::byte{'d'}, std::byte{'i'}, std::byte{'.'},
    std::byte{'c'}, std::byte{'h'}, std::byte{'/'},
    std::byte{'t'}, std::byte{'a'}, std::byte{'g'}, std::byte{'?'},
    std::byte{'p'}, std::byte{'i'}, std::byte{'c'}, std::byte{'c'},
    std::byte{'='},
    // PICC placeholder: 32 hex zeros (offset 0x22)
    std::byte{'0'}, std::byte{'0'}, std::byte{'0'}, std::byte{'0'},
    std::byte{'0'}, std::byte{'0'}, std::byte{'0'}, std::byte{'0'},
    std::byte{'0'}, std::byte{'0'}, std::byte{'0'}, std::byte{'0'},
    std::byte{'0'}, std::byte{'0'}, std::byte{'0'}, std::byte{'0'},
    std::byte{'0'}, std::byte{'0'}, std::byte{'0'}, std::byte{'0'},
    std::byte{'0'}, std::byte{'0'}, std::byte{'0'}, std::byte{'0'},
    std::byte{'0'}, std::byte{'0'}, std::byte{'0'}, std::byte{'0'},
    std::byte{'0'}, std::byte{'0'}, std::byte{'0'}, std::byte{'0'},
    // "&cmac="
    std::byte{'&'}, std::byte{'c'}, std::byte{'m'}, std::byte{'a'},
    std::byte{'c'}, std::byte{'='},
    // CMAC placeholder: 16 hex zeros (offset 0x48)
    std::byte{'0'}, std::byte{'0'}, std::byte{'0'}, std::byte{'0'},
    std::byte{'0'}, std::byte{'0'}, std::byte{'0'}, std::byte{'0'},
    std::byte{'0'}, std::byte{'0'}, std::byte{'0'}, std::byte{'0'},
    std::byte{'0'}, std::byte{'0'}, std::byte{'0'}, std::byte{'0'},
}};
// clang-format on

// ---------------------------------------------------------------------------
// ChangeFileSettings payload for enabling SDM on file 0x02
// ---------------------------------------------------------------------------
// 15 bytes plaintext:
//   [0]     FileOption: 0x40 (SDM enabled, CommMode Plain)
//   [1-2]   AccessRights: Read=Eh(free), Write=0h(Key0), RW=Eh(free),
//           Change=0h(Key0)
//   [3]     SDMOptions: 0xC1 (ASCII(bit0) + SDMReadCtr(bit6) + UID(bit7))
//   [4-5]   SDMAccessRights (LE 16-bit): MetaRead=1(Key1), FileRead=3(Key3),
//           RFU=Fh, CtrRet=Eh(free)
//   [6-8]   PICCDataOffset (LE 24-bit): 0x22
//   [9-11]  SDMMACInputOffset (LE 24-bit): 0x22
//   [12-14] SDMMACOffset (LE 24-bit): 0x48

// clang-format off
constexpr std::array<std::byte, 15> kSdmFileSettings = {{
    std::byte{0x40},  // FileOption: SDM + Plain
    std::byte{0xE0},  // AccessRights[0]: Read=Eh, Write=0h
    std::byte{0xE0},  // AccessRights[1]: RW=Eh, Change=0h
    std::byte{0xC1},  // SDMOptions: ASCII(bit0) | SDMReadCtr(bit6) | UID(bit7)
    std::byte{0xFE},  // SDMAccessRights low byte: RFU=Fh, CtrRet=Eh
    std::byte{0x13},  // SDMAccessRights high byte: MetaRead=1, FileRead=3
    // PICCDataOffset (LE 24-bit)
    std::byte{0x22}, std::byte{0x00}, std::byte{0x00},
    // SDMMACInputOffset (LE 24-bit)
    std::byte{0x22}, std::byte{0x00}, std::byte{0x00},
    // SDMMACOffset (LE 24-bit)
    std::byte{0x48}, std::byte{0x00}, std::byte{0x00},
}};
// clang-format on

/// Check if GetFileSettings response matches the expected SDM configuration.
///
/// Compares all settings fields (FileOption, AccessRights, SDMOptions,
/// SDMAccessRights, offsets) against kSdmFileSettings. If any field differs
/// — including after a scheme change — the tag will be reconfigured.
///
/// GetFileSettings response layout (19 bytes when SDM enabled):
///   [0]    FileType
///   [1]    FileOption        ← kSdmFileSettings[0]
///   [2-3]  AccessRights      ← kSdmFileSettings[1-2]
///   [4-6]  FileSize (3 bytes, not in kSdmFileSettings)
///   [7]    SDMOptions        ← kSdmFileSettings[3]
///   [8-9]  SDMAccessRights   ← kSdmFileSettings[4-5]
///   [10-18] Offsets (3x3)    ← kSdmFileSettings[6-14]
inline bool IsSdmConfigured(pw::ConstByteSpan settings) {
  // SDM-enabled response is exactly 19 bytes
  if (settings.size() < 19) {
    return false;
  }

  // FileOption + AccessRights: kSdmFileSettings[0-2] → response[1-3]
  for (size_t i = 0; i < 3; ++i) {
    if (settings[1 + i] != kSdmFileSettings[i]) {
      return false;
    }
  }

  // SDMOptions + SDMAccessRights + offsets: kSdmFileSettings[3-14] → response[7-18]
  // Offset of +4 because FileSize (3 bytes at [4-6]) is not in kSdmFileSettings
  for (size_t i = 3; i < kSdmFileSettings.size(); ++i) {
    if (settings[i + 4] != kSdmFileSettings[i]) {
      return false;
    }
  }

  return true;
}

}  // namespace maco::personalize::sdm
