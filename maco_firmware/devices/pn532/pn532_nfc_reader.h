// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <optional>

#include "maco_firmware/devices/pn532/pn532_command.h"
#include "maco_firmware/devices/pn532/tag_info.h"
#include "maco_firmware/modules/nfc_reader/nfc_event.h"
#include "maco_firmware/modules/nfc_reader/nfc_reader.h"
#include "maco_firmware/modules/nfc_reader/transceive_request.h"
#include "maco_firmware/modules/nfc_tag/nfc_tag.h"
#include "pw_allocator/allocator.h"
#include "pw_async2/coro.h"
#include "pw_async2/coro_or_else_task.h"
#include "pw_async2/dispatcher.h"
#include "pw_async2/value_future.h"
#include "pw_bytes/span.h"
#include "pw_chrono/system_clock.h"
#include "pw_digital_io/digital_io.h"
#include "pw_result/result.h"
#include "pw_status/status.h"
#include "pw_stream/stream.h"

namespace maco::nfc {

/// Timing constants for NFC operations.
struct Pn532ReaderConfig {
  /// Timeout for tag detection attempts.
  pw::chrono::SystemClock::duration detection_timeout =
      std::chrono::milliseconds(500);

  /// Interval between presence checks when tag is present.
  pw::chrono::SystemClock::duration presence_check_interval =
      std::chrono::milliseconds(200);

  /// Timeout for presence check operations.
  pw::chrono::SystemClock::duration presence_check_timeout =
      std::chrono::milliseconds(100);

  /// Default timeout for transceive operations.
  pw::chrono::SystemClock::duration default_transceive_timeout =
      std::chrono::milliseconds(1000);
};

/// PN532-based NFC reader implementation using C++20 coroutines.
///
/// This class implements the NfcReader interface using pw_async2 coroutines.
/// The main loop runs as a coroutine that:
/// - Detects tags automatically
/// - Performs presence checks
/// - Handles application transceive requests
///
/// All NFC operations are non-blocking, using co_await for suspension.
class Pn532NfcReader : public NfcReader {
 public:
  /// Default timeout at 115200 baud per PN532 User Manual Section 6.2.2
  static constexpr auto kDefaultTimeout = std::chrono::milliseconds(89);

  /// Construct a PN532 NFC reader.
  /// @param uart UART stream for communication (must be 115200 baud)
  /// @param reset_pin Reset pin (active low)
  /// @param alloc Allocator for coroutine frames (needs ~512 bytes)
  /// @param config Configuration for timing parameters
  Pn532NfcReader(pw::stream::ReaderWriter& uart,
                 pw::digital_io::DigitalOut& reset_pin,
                 pw::allocator::Allocator& alloc,
                 const Pn532ReaderConfig& config = Pn532ReaderConfig());

  // -- NfcReader Interface --

  pw::Status Init() override;
  void Start(pw::async2::Dispatcher& dispatcher) override;
  bool HasTag() const override { return current_tag_ != nullptr; }
  std::shared_ptr<NfcTag> GetCurrentTag() override { return current_tag_; }

  TransceiveFuture RequestTransceive(
      pw::ConstByteSpan command,
      pw::ByteSpan response_buffer,
      pw::chrono::SystemClock::duration timeout) override;

  EventFuture SubscribeOnce() override;

  // -- Testing Accessors --

  /// Check if a transceive request is pending.
  bool has_pending_request() const { return pending_request_.has_value(); }

  /// Get the current target number.
  uint8_t current_target_number() const { return current_target_number_; }

 protected:
  // -- Coroutine Methods --

  /// Main reader loop coroutine.
  /// Runs continuously: detect → probe → monitor → (tag gone) → repeat
  pw::async2::Coro<pw::Status> RunLoop(pw::async2::CoroContext& cx);

  /// Send a PN532 command and receive response.
  /// Handles frame building, ACK, and response parsing.
  pw::async2::Coro<pw::Result<pw::ConstByteSpan>> SendCommand(
      pw::async2::CoroContext& cx,
      const Pn532Command& cmd,
      pw::chrono::SystemClock::time_point deadline);

  /// Detect a tag using InListPassiveTarget.
  pw::async2::Coro<pw::Result<TagInfo>> DetectTag(
      pw::async2::CoroContext& cx,
      pw::chrono::SystemClock::duration timeout);

  /// Execute an InDataExchange command.
  pw::async2::Coro<pw::Result<size_t>> Transceive(
      pw::async2::CoroContext& cx,
      pw::ConstByteSpan command,
      pw::ByteSpan response_buffer,
      pw::chrono::SystemClock::duration timeout);

  /// Check if tag is still present using Diagnose.
  pw::async2::Coro<pw::Result<bool>> CheckTagPresent(
      pw::async2::CoroContext& cx,
      pw::chrono::SystemClock::duration timeout);

  // -- Blocking Init Helpers --

  pw::Status DoInit();
  pw::Status DoReset();
  pw::Status DoReleaseTag(uint8_t target_number);
  pw::Status RecoverFromDesync();

  pw::Status WriteFrameBlocking(uint8_t command, pw::ConstByteSpan params);
  pw::Status WaitForAckBlocking(pw::chrono::SystemClock::duration timeout);
  pw::Result<size_t> ReadFrameBlocking(
      uint8_t expected_command,
      pw::ByteSpan response_buffer,
      pw::chrono::SystemClock::duration timeout);
  pw::Result<size_t> SendCommandAndReceiveBlocking(
      uint8_t command,
      pw::ConstByteSpan params,
      pw::ByteSpan response_buffer,
      pw::chrono::SystemClock::duration timeout);
  bool ScanForStartSequenceBlocking(pw::chrono::SystemClock::duration timeout);

  // -- Utility --

  void DrainReceiveBuffer();
  pw::Result<TagInfo> ParseDetectResponse(pw::ConstByteSpan payload);
  pw::Result<size_t> ParseTransceiveResponse(pw::ConstByteSpan payload,
                                              pw::ByteSpan response_buffer);
  pw::Result<bool> ParseCheckPresentResponse(pw::ConstByteSpan payload);

 private:
  // Hardware
  pw::stream::ReaderWriter& uart_;
  pw::digital_io::DigitalOut& reset_pin_;
  Pn532ReaderConfig config_;

  // Coroutine infrastructure
  pw::async2::CoroContext coro_cx_;
  std::optional<pw::async2::CoroOrElseTask> reader_task_;
  pw::async2::Dispatcher* dispatcher_ = nullptr;

  // Tag state
  std::shared_ptr<NfcTag> current_tag_;
  uint8_t current_target_number_ = 0;

  // Pending transceive request from application
  std::optional<TransceiveRequest> pending_request_;
  pw::async2::ValueProvider<pw::Result<size_t>> transceive_result_provider_;

  // Event subscription
  pw::async2::ValueProvider<NfcEvent> event_provider_;

  // I/O buffers for coroutines (avoids stack allocation in coro frame)
  std::array<std::byte, 6> ack_buffer_;
  std::array<std::byte, 265> tx_buffer_;
  std::array<std::byte, 265> rx_buffer_;
};

}  // namespace maco::nfc
