// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <algorithm>
#include <array>
#include <cstddef>
#include <cstdint>

#include "maco_firmware/modules/nfc_tag/nfc_tag.h"
#include "pw_bytes/span.h"
#include "pw_result/result.h"

namespace maco::nfc {

class MockNfcReader;

/// Base class for mock tags with transceive handling and RF-field lifecycle.
///
/// Concrete subclasses implement HandleTransceive to provide stateful
/// APDU processing. MockNfcReader delegates transceive calls to the
/// current tag and manages OnEnterField/OnLeaveField lifecycle.
class MockTag : public NfcTag {
 public:
  MockTag(pw::ConstByteSpan uid, uint8_t sak, bool supports_iso14443_4 = true)
      : sak_(sak), supports_iso14443_4_(supports_iso14443_4) {
    uid_length_ = std::min(uid.size(), uid_.size());
    std::copy(uid.begin(), uid.begin() + uid_length_, uid_.begin());
  }

  // NfcTag interface
  pw::ConstByteSpan uid() const override {
    return pw::ConstByteSpan(uid_.data(), uid_length_);
  }
  uint8_t sak() const override { return sak_; }
  uint8_t target_number() const override { return 1; }
  bool supports_iso14443_4() const override { return supports_iso14443_4_; }

  /// Handle a transceive command. Called by MockNfcReader::RequestTransceive.
  /// @param command APDU command bytes
  /// @param response_buffer Buffer for the response
  /// @return Number of response bytes, or error
  virtual pw::Result<size_t> HandleTransceive(
      pw::ConstByteSpan command, pw::ByteSpan response_buffer) = 0;

 protected:
  friend class MockNfcReader;

  /// Called when this tag enters the RF field.
  virtual void OnEnterField() {}

  /// Called when this tag leaves the RF field.
  virtual void OnLeaveField() {}

 private:
  std::array<std::byte, 10> uid_{};
  size_t uid_length_ = 0;
  uint8_t sak_;
  bool supports_iso14443_4_;
};

}  // namespace maco::nfc
