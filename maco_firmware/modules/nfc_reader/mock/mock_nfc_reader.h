// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <array>
#include <memory>
#include <optional>
#include <vector>

#include "maco_firmware/modules/nfc_reader/nfc_event.h"
#include "maco_firmware/modules/nfc_reader/nfc_reader.h"
#include "maco_firmware/modules/nfc_tag/nfc_tag.h"
#include "pw_async2/value_future.h"
#include "pw_bytes/span.h"
#include "pw_result/result.h"

namespace maco::nfc {

/// Simple mock tag for testing and simulation.
class MockTag : public NfcTag {
 public:
  MockTag(pw::ConstByteSpan uid, uint8_t sak, bool supports_iso14443_4 = true)
      : sak_(sak), supports_iso14443_4_(supports_iso14443_4) {
    uid_length_ = std::min(uid.size(), uid_.size());
    std::copy(uid.begin(), uid.begin() + uid_length_, uid_.begin());
  }

  pw::ConstByteSpan uid() const override {
    return pw::ConstByteSpan(uid_.data(), uid_length_);
  }

  uint8_t sak() const override { return sak_; }

  uint8_t target_number() const override { return 1; }

  bool supports_iso14443_4() const override { return supports_iso14443_4_; }

 private:
  std::array<std::byte, 10> uid_{};
  size_t uid_length_ = 0;
  uint8_t sak_;
  bool supports_iso14443_4_;
};

/// Mock NFC reader for host simulator and unit tests.
///
/// Provides simulation helpers to inject tag arrival/departure events
/// and configure transceive responses. Used by:
/// - Host simulator (with keyboard or UI triggers)
/// - Unit tests (programmatic control)
class MockNfcReader : public NfcReader {
 public:
  MockNfcReader() = default;

  // -- NfcReader Interface --

  pw::Status Init() override { return pw::OkStatus(); }

  void Start(pw::async2::Dispatcher& /*dispatcher*/) override {
    started_ = true;
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
  /// @param tag The tag to simulate (typically a MockTag)
  void SimulateTagArrival(std::shared_ptr<NfcTag> tag);

  /// Simulate a tag departing from the field.
  void SimulateTagDeparture();

  /// Create and simulate a tag with the given parameters.
  /// @param uid UID bytes
  /// @param sak SAK byte
  /// @return The created tag
  std::shared_ptr<MockTag> SimulateTagArrival(pw::ConstByteSpan uid,
                                               uint8_t sak);

  /// Set the response for the next transceive operation.
  /// The response data will be copied to the response buffer.
  /// @param response Response bytes to return
  void SetNextTransceiveResponse(pw::ConstByteSpan response);

  /// Set an error for the next transceive operation.
  /// @param status Error status to return
  void SetNextTransceiveError(pw::Status status);

  // -- Test Inspection --

  /// Check if Start() was called.
  bool started() const { return started_; }

  /// Get the last command sent via RequestTransceive.
  pw::ConstByteSpan last_command() const {
    return pw::ConstByteSpan(last_command_.data(), last_command_.size());
  }

  /// Get the number of transceive calls.
  size_t transceive_count() const { return transceive_count_; }

 private:
  bool started_ = false;
  std::shared_ptr<NfcTag> current_tag_;

  // Transceive simulation
  std::vector<std::byte> next_transceive_response_;
  std::optional<pw::Status> next_transceive_error_;
  std::vector<std::byte> last_command_;
  size_t transceive_count_ = 0;

  // Event subscription - ValueProvider for async event delivery
  pw::async2::ValueProvider<NfcEvent> event_provider_;
};

}  // namespace maco::nfc
