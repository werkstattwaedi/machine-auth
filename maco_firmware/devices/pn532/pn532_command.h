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

/// Outcome of a single tag presence check (Diagnose attention request).
///
/// Tri-state so the reader loop can tell a *genuine* removal (authoritative,
/// abort immediately) apart from an *ambiguous* link fault (a transient RF
/// glitch that must be debounced before declaring departure). Flattening every
/// failed check to "gone" was aborting otherwise-good auths on a single RF
/// hiccup (issue #548).
enum class PresenceResult {
  /// Diagnose answered cleanly (status 0x00) — the tag is definitely present.
  Present,
  /// Diagnose returned a clean, well-formed status 0x01 — a genuine removal.
  Departed,
  /// Timeout / malformed frame / unexpected status — ambiguous; could be a
  /// transient RF glitch rather than a real removal. Caller debounces.
  LinkFault,
};

/// Decode the *payload* of a Diagnose (attention request) response — a single
/// status byte already extracted by ParseResponse — into a tri-state result.
///
/// A clean, well-formed single-byte frame is what distinguishes a genuine
/// removal from a link fault:
///   0x00 → Present (card answered)
///   0x01 → Departed (card did not answer, a genuine removal)
/// Any other status (e.g. 0x27 = command not acceptable in the current
/// context) or a wrong-size frame is malformed/ambiguous → LinkFault, never a
/// confirmed removal.
///
/// Pure function (lives here, not on the reader, so it is host-unit-testable —
/// the reader's pb::AsyncUart is Cortex-M33-only and has no host fake, #536).
PresenceResult ParseCheckPresentResponse(pw::ConstByteSpan payload);

}  // namespace maco::nfc
