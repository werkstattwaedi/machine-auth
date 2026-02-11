// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <memory>
#include <vector>

#include "maco_firmware/modules/nfc_reader/nfc_event.h"
#include "maco_firmware/modules/nfc_reader/nfc_reader.h"
#include "maco_firmware/modules/nfc_tag/iso14443_tag_mock.h"
#include "maco_firmware/modules/nfc_tag/mock_tag.h"
#include "pw_async2/value_future.h"
#include "pw_bytes/span.h"
#include "pw_result/result.h"

namespace maco::nfc {

/// Mock NFC reader for host simulator and unit tests.
///
/// Transceive operations are delegated to the current MockTag's
/// HandleTransceive method, enabling stateful multi-step protocols
/// (e.g., NTAG424 authentication).
class MockNfcReader : public NfcReader {
 public:
  MockNfcReader() = default;

  // -- NfcReader Interface --

  InitFuture Start(pw::async2::Dispatcher& /*dispatcher*/) override {
    started_ = true;
    return InitFuture::Resolved(pw::OkStatus());
  }

  bool HasTag() const override { return current_tag_ != nullptr; }

  std::shared_ptr<NfcTag> GetCurrentTag() override { return current_tag_; }

  TransceiveFuture RequestTransceive(
      pw::ConstByteSpan command,
      pw::ByteSpan response_buffer,
      pw::chrono::SystemClock::duration timeout) override;

  EventFuture SubscribeOnce() override;

  // -- Simulation Helpers --

  /// Simulate a tag arriving in the field.
  void SimulateTagArrival(std::shared_ptr<MockTag> tag);

  /// Simulate a tag departing from the field.
  void SimulateTagDeparture();

  /// Convenience: create an Iso14443TagMock and simulate arrival.
  std::shared_ptr<Iso14443TagMock> SimulateTagArrival(pw::ConstByteSpan uid,
                                                       uint8_t sak);

  // -- Test Inspection --

  bool started() const { return started_; }

  pw::ConstByteSpan last_command() const {
    return pw::ConstByteSpan(last_command_.data(), last_command_.size());
  }

  size_t transceive_count() const { return transceive_count_; }

 private:
  bool started_ = false;
  std::shared_ptr<MockTag> current_tag_;

  // Command inspection
  std::vector<std::byte> last_command_;
  size_t transceive_count_ = 0;

  // Event subscription
  pw::async2::ValueProvider<NfcEvent> event_provider_;
};

}  // namespace maco::nfc
