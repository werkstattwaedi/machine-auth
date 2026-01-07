// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <cstddef>
#include <cstdint>

#include "maco_firmware/modules/nfc_reader/nfc_reader_driver.h"
#include "maco_firmware/modules/nfc_tag/nfc_tag.h"
#include "pw_bytes/span.h"
#include "pw_chrono/system_clock.h"
#include "pw_result/result.h"
#include "pw_status/status.h"

namespace maco::nfc {

/// ISO 14443-4 compliant tag (supports APDUs).
///
/// This class wraps a detected tag and provides APDU transceive functionality.
/// It is templated on the driver type to support the CRTP pattern.
template <typename Driver>
class Iso14443Tag : public NfcTag {
 public:
  /// Construct an ISO 14443-4 tag.
  /// @param driver Reference to the NFC reader driver
  /// @param info Tag information from detection
  Iso14443Tag(Driver& driver, const TagInfo& info)
      : driver_(driver), info_(info) {}

  pw::ConstByteSpan uid() const override {
    return pw::ConstByteSpan(info_.uid.data(), info_.uid_length);
  }

  bool supports_iso14443_4() const override { return info_.supports_iso14443_4; }

  /// Get the target number (for driver commands).
  uint8_t target_number() const { return info_.target_number; }

  /// Get the SAK byte.
  uint8_t sak() const { return info_.sak; }

  /// Exchange an APDU with the tag (async).
  /// @param command APDU command bytes
  /// @param response_buffer Buffer for response
  /// @param timeout Maximum time for exchange
  /// @return Driver-specific future that resolves to response length or error
  auto Transceive(pw::ConstByteSpan command,
                  pw::ByteSpan response_buffer,
                  pw::chrono::SystemClock::duration timeout) {
    return driver_.Transceive(command, response_buffer, timeout);
  }

 protected:
  Driver& driver_;
  TagInfo info_;
};

}  // namespace maco::nfc
