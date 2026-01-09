// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <cstddef>
#include <cstdint>

#include "maco_firmware/devices/pn532/tag_info.h"
#include "maco_firmware/modules/nfc_reader/transceive_request.h"
#include "maco_firmware/modules/nfc_tag/nfc_tag.h"
#include "pw_bytes/span.h"
#include "pw_chrono/system_clock.h"
#include "pw_result/result.h"
#include "pw_status/status.h"

namespace maco::nfc {

// Forward declaration to avoid circular dependency
template <typename Driver>
class NfcReader;

/// ISO 14443-4 compliant tag (supports APDUs).
///
/// This class wraps a detected tag and provides APDU transceive functionality.
/// Operations are routed through the NfcReader for FSM coordination.
/// It is templated on the driver type to support the CRTP pattern.
template <typename Driver>
class Iso14443Tag : public NfcTag {
 public:
  /// Construct an ISO 14443-4 tag.
  /// @param reader Reference to the NfcReader (for operation routing)
  /// @param driver Reference to the NFC reader driver
  /// @param info Tag information from detection
  Iso14443Tag(NfcReader<Driver>& reader, Driver& driver, const TagInfo& info)
      : reader_(reader), driver_(driver), info_(info) {}

  pw::ConstByteSpan uid() const override {
    return pw::ConstByteSpan(info_.uid.data(), info_.uid_length);
  }

  bool supports_iso14443_4() const override {
    return info_.supports_iso14443_4;
  }

  /// Get the target number (for driver commands).
  uint8_t target_number() const override { return info_.target_number; }

  /// Get the SAK byte.
  uint8_t sak() const override { return info_.sak; }

  /// Exchange an APDU with the tag (async).
  ///
  /// Operations are routed through the NfcReader for FSM coordination.
  /// The reader's state machine ensures operations don't conflict with
  /// presence checking or other internal operations.
  ///
  /// @param command APDU command bytes
  /// @param response_buffer Buffer for response
  /// @param timeout Maximum time for exchange
  /// @return Future that resolves to response length or error
  TransceiveRequestFuture Transceive(
      pw::ConstByteSpan command,
      pw::ByteSpan response_buffer,
      pw::chrono::SystemClock::duration timeout
  ) {
    return reader_.RequestTransceive(command, response_buffer, timeout);
  }

 protected:
  NfcReader<Driver>& reader_;
  Driver& driver_;
  TagInfo info_;
};

}  // namespace maco::nfc
