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
#include "pb_uart/async_uart.h"

namespace maco::nfc {

// PresenceResult (tri-state presence outcome) lives in pn532_command.h,
// alongside the pure ParseCheckPresentResponse it is produced by.

/// Timing constants for NFC operations.
struct Pn532ReaderConfig {
  /// Timeout for tag detection attempts.
  pw::chrono::SystemClock::duration detection_timeout =
      std::chrono::milliseconds(500);

  /// Interval between presence checks when tag is present.
  pw::chrono::SystemClock::duration presence_check_interval =
      std::chrono::milliseconds(200);

  /// Timeout for presence check operations.
  ///
  /// Kept at 100 ms: the floor here is the PN532's *internal* "card gone"
  /// processing (~tens of ms), not wire time. Issue #548's "~86.8 ms 1-byte
  /// HSU timeout" premise was a µs/ms units slip — 10 bits ÷ 115200 baud =
  /// 86.8 *µs*/byte, not ms — so 100 ms already clears the real floor with
  /// margin. ReadWithTimeout returns the instant a frame arrives, so this
  /// ceiling only bounds the pathological no-frame path; raising it would not
  /// slow real departures.
  pw::chrono::SystemClock::duration presence_check_timeout =
      std::chrono::milliseconds(100);

  /// Consecutive ambiguous link-fault presence checks required before declaring
  /// the tag departed. A genuine (clean status 0x01) removal is authoritative
  /// and ignores this — only link faults are debounced (issue #548).
  int presence_absent_threshold = 2;

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
  /// @param uart Async UART for communication (must be initialized at 115200 baud)
  /// @param reset_pin Reset pin (active low)
  /// @param alloc Allocator for coroutine frames (needs ~512 bytes)
  /// @param config Configuration for timing parameters
  Pn532NfcReader(pb::AsyncUart& uart,
                 pw::digital_io::DigitalOut& reset_pin,
                 pw::allocator::Allocator& alloc,
                 const Pn532ReaderConfig& config = Pn532ReaderConfig());

  // -- NfcReader Interface --

  InitFuture Start(pw::async2::Dispatcher& dispatcher) override;
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
  pw::async2::Coro<pw::Status> RunLoop(pw::async2::CoroContext cx);

  /// Send a PN532 command and receive response.
  /// Handles frame building, ACK, and response parsing.
  /// @param timeout_ms Timeout in milliseconds (rounded up for sub-ms precision)
  pw::async2::Coro<pw::Result<pw::ConstByteSpan>> SendCommand(
      pw::async2::CoroContext cx,
      const Pn532Command& cmd,
      uint32_t timeout_ms);

  /// Detect a tag using InListPassiveTarget.
  pw::async2::Coro<pw::Result<TagInfo>> DetectTag(
      pw::async2::CoroContext cx,
      pw::chrono::SystemClock::duration timeout);

  /// Execute an InDataExchange command.
  pw::async2::Coro<pw::Result<size_t>> Transceive(
      pw::async2::CoroContext cx,
      pw::ConstByteSpan command,
      pw::ByteSpan response_buffer,
      pw::chrono::SystemClock::duration timeout);

  /// Check if tag is still present using Diagnose. Tri-state so the caller can
  /// distinguish a genuine removal from an ambiguous link fault (issue #548).
  pw::async2::Coro<PresenceResult> CheckTagPresent(
      pw::async2::CoroContext cx,
      pw::chrono::SystemClock::duration timeout);

  // -- Async Init --

  /// Async initialization coroutine (hardware reset, SAMConfiguration, etc.)
  pw::async2::Coro<pw::Status> DoAsyncInit(pw::async2::CoroContext cx);

  /// Release target asynchronously
  pw::async2::Coro<pw::Status> DoReleaseTag(pw::async2::CoroContext cx,
                                             uint8_t target_number);

  /// Recover from protocol desync (sends ACK abort, waits for in-flight data)
  pw::async2::Coro<pw::Status> RecoverFromDesync(pw::async2::CoroContext cx);

  // -- Utility --

  void DrainReceiveBuffer();

  /// Abandon a parked transceive request, resolving its future with
  /// FailedPrecondition. Called on the tag-departure path so a request that
  /// was queued while the tag was still present cannot outlive it.
  void DrainPendingRequest();

  pw::Result<TagInfo> ParseDetectResponse(pw::ConstByteSpan payload);
  pw::Result<size_t> ParseTransceiveResponse(pw::ConstByteSpan payload,
                                              pw::ByteSpan response_buffer);
  // Presence parsing is the free function ParseCheckPresentResponse in
  // pn532_command.h (pure + host-testable).

 private:
  // Hardware
  pb::AsyncUart& uart_;
  pw::digital_io::DigitalOut& reset_pin_;
  Pn532ReaderConfig config_;

  // Coroutine infrastructure
  pw::async2::CoroContext coro_cx_;
  std::optional<pw::async2::CoroOrElseTask> reader_task_;
  pw::async2::Dispatcher* dispatcher_ = nullptr;
  bool started_ = false;  // Guard against multiple Start() calls

  // Init status provider
  pw::async2::ValueProvider<pw::Status> init_status_provider_;

  // Tag state
  std::shared_ptr<NfcTag> current_tag_;
  uint8_t current_target_number_ = 0;

  // Bumped on every tag arrival. Stamped into each TransceiveRequest so a
  // request captured against a departed tag can never bind to its successor.
  uint32_t tag_generation_ = 0;

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
