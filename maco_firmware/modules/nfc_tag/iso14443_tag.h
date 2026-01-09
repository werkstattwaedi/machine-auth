// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <cstddef>
#include <cstdint>

#include "maco_firmware/devices/pn532/tag_info.h"
#include "maco_firmware/modules/nfc_reader/nfc_reader.h"
#include "maco_firmware/modules/nfc_tag/nfc_tag.h"
#include "pw_bytes/span.h"
#include "pw_chrono/system_clock.h"
#include "pw_result/result.h"
#include "pw_status/status.h"

namespace maco::nfc {

/// ISO 14443-4 compliant tag (supports APDUs).
///
/// This class wraps a detected tag and provides APDU transceive functionality.
/// Operations are routed through the NfcReader for FSM coordination.
class Iso14443Tag : public NfcTag {
 public:
  /// Construct an ISO 14443-4 tag.
  /// @param reader Reference to the NfcReader (for operation routing)
  /// @param info Tag information from detection
  Iso14443Tag(NfcReader& reader, const TagInfo& info)
      : reader_(reader), info_(info) {}

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
  TransceiveFuture Transceive(
      pw::ConstByteSpan command,
      pw::ByteSpan response_buffer,
      pw::chrono::SystemClock::duration timeout) {
    return reader_.RequestTransceive(command, response_buffer, timeout);
  }

 protected:
  NfcReader& reader_;
  TagInfo info_;
};

}  // namespace maco::nfc
