// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include "pw_status/status.h"

namespace maco::nfc {

/// Classify PN532 errors to determine if tag is likely gone.
/// Based on PN532 User Manual error codes (p.67).
///
/// These errors indicate the tag is no longer responding:
/// - DeadlineExceeded: PN532 error 0x01 (Timeout)
/// - DataLoss: PN532 error 0x02 (CRC), 0x03 (Parity), 0x05 (Framing)
/// - Unavailable: PN532 error 0x0A (RF field not active)
inline bool IsTagGoneError(pw::Status status) {
  return status.IsDeadlineExceeded() || status.IsDataLoss() ||
         status.IsUnavailable();
}

/// Errors that indicate protocol desync (need recovery).
/// Internal buffer overflow, framing errors suggest desync.
inline bool IsDesyncError(pw::Status status) { return status.IsInternal(); }

}  // namespace maco::nfc
