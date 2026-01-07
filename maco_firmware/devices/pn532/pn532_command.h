// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <cstddef>
#include <cstdint>

#include "pw_bytes/span.h"
#include "pw_result/result.h"

namespace maco::nfc {

/// PN532 command specification: command byte + parameter payload.
/// Can build frames for sending and parse response frames.
///
/// Frame format (PN532 User Manual Section 6.2.1):
/// [PREAMBLE][START_CODE][LEN][LCS][TFI][CMD][PARAMS...][DCS][POSTAMBLE]
///    0x00    0x00 0xFF   len  ~len+1 0xD4 cmd  ...      chk   0x00
struct Pn532Command {
  uint8_t command;           ///< Command code (e.g., 0x4A for InListPassiveTarget)
  pw::ConstByteSpan params;  ///< Command-specific parameters

  /// Build a command frame into the provided buffer.
  /// @param buffer Output buffer (must be at least params.size() + 10 bytes)
  /// @return Frame length, or 0 on error (buffer too small, params too large)
  size_t BuildFrame(pw::ByteSpan buffer) const;

  /// Parse a response frame and extract the payload.
  /// Validates: start sequence, LEN/LCS checksum, TFI, CMD match, DCS checksum.
  ///
  /// @param expected_command The command that was sent (response should be cmd+1)
  /// @param frame The complete response frame including preamble
  /// @return Payload span (data after TFI+CMD, before DCS), or error status
  ///
  /// Possible errors:
  /// - DataLoss: Invalid checksums, TFI, or command mismatch
  /// - Internal: Error frame received from PN532
  static pw::Result<pw::ConstByteSpan> ParseResponse(
      uint8_t expected_command,
      pw::ConstByteSpan frame);

  /// Calculate checksum for length byte (one's complement + 1).
  static uint8_t CalculateLengthChecksum(uint8_t len);

  /// Calculate checksum for data (one's complement of sum + 1).
  static uint8_t CalculateDataChecksum(pw::ConstByteSpan data);

  /// Validate length checksum.
  static bool ValidateLengthChecksum(uint8_t len, uint8_t lcs);

  /// Validate data checksum.
  static bool ValidateDataChecksum(pw::ConstByteSpan data, uint8_t dcs);
};

}  // namespace maco::nfc
