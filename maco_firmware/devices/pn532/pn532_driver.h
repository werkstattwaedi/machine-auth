// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <array>
#include <cstddef>
#include <cstdint>

#include "maco_firmware/devices/pn532/pn532_await_idle_future.h"
#include "maco_firmware/devices/pn532/pn532_check_present_future.h"
#include "maco_firmware/devices/pn532/pn532_detect_tag_future.h"
#include "maco_firmware/devices/pn532/pn532_transceive_future.h"
#include "maco_firmware/modules/nfc_reader/nfc_reader_driver.h"
#include "pw_async2/future.h"
#include "pw_bytes/span.h"
#include "pw_chrono/system_clock.h"
#include "pw_digital_io/digital_io.h"
#include "pw_result/result.h"
#include "pw_status/status.h"
#include "pw_stream/stream.h"

namespace maco::nfc {

/// PN532 NFC controller driver over UART (HSU interface).
///
/// Implements the NfcReaderDriverBase CRTP interface for tag detection,
/// APDU exchange, and presence checking.
///
/// All NFC operations return futures that must be polled to completion.
/// The driver enforces single-operation constraint (hardware limitation:
/// only one NFC command can be in flight at a time).
///
/// All I/O is non-blocking - futures poll UART and return Pending if
/// data is not yet available.
///
/// Protocol reference: PN532 User Manual, Section 6.2
/// https://files.waveshare.com/upload/b/bb/Pn532um.pdf
class Pn532Driver : public NfcReaderDriverBase<Pn532Driver> {
 public:
  /// Default timeout at 115200 baud per PN532 User Manual Section 6.2.2
  static constexpr auto kDefaultTimeout = std::chrono::milliseconds(89);

  /// Construct a PN532 driver.
  /// @param uart UART stream for communication (must be configured for 115200
  /// baud)
  /// @param reset_pin Reset pin (active low)
  Pn532Driver(pw::stream::ReaderWriter& uart,
              pw::digital_io::DigitalOut& reset_pin);

  // -- CRTP Implementation Methods --

  /// Initialize the driver: reset, wakeup, SAMConfiguration, RFConfiguration.
  /// Note: This is blocking (uses sync I/O during init only).
  pw::Status DoInit();

  /// Hardware reset via reset pin.
  pw::Status DoReset();

  /// Detect a tag using InListPassiveTarget (async).
  /// @param timeout Maximum time to wait for a tag
  /// @return Future that resolves with TagInfo on success.
  Pn532DetectTagFuture DoDetectTag(pw::chrono::SystemClock::duration timeout);

  /// Exchange APDU with tag using InDataExchange (async).
  /// @param command APDU command bytes
  /// @param response_buffer Buffer for response
  /// @param timeout Maximum time for exchange
  /// @return Future that resolves with response length on success.
  Pn532TransceiveFuture DoTransceive(
      pw::ConstByteSpan command,
      pw::ByteSpan response_buffer,
      pw::chrono::SystemClock::duration timeout);

  /// Check if tag is present using Diagnose(NumTst=0x06) (async).
  /// @param timeout Maximum time for check
  /// @return Future that resolves with true if present, false if removed.
  Pn532CheckPresentFuture DoCheckTagPresent(
      pw::chrono::SystemClock::duration timeout);

  /// Release tag using InRelease.
  pw::Status DoReleaseTag(uint8_t target_number);

  /// Recover from protocol desync (drain buffer, send ACK to abort).
  pw::Status RecoverFromDesync();

  /// Drain any pending data from the UART receive buffer.
  void DrainReceiveBuffer();

  /// Check if any operation is currently in progress.
  bool IsBusy() const;

  /// Returns a future that completes when no operation is in progress.
  /// Use this to wait before starting a new operation if another might be
  /// in progress.
  Pn532AwaitIdleFuture AwaitIdle();

  /// Get the UART stream (for futures to access).
  pw::stream::ReaderWriter& uart() { return uart_; }

  /// Get the current target number (for futures to access).
  uint8_t current_target_number() const { return current_target_number_; }

  /// Set the current target number (normally set by DetectTag).
  void set_current_target_number(uint8_t target) {
    current_target_number_ = target;
  }

 private:
  friend class Pn532DetectTagFuture;
  friend class Pn532TransceiveFuture;
  friend class Pn532CheckPresentFuture;

  // -- Init-only blocking helpers --

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

  // -- Member variables --

  pw::stream::ReaderWriter& uart_;
  pw::digital_io::DigitalOut& reset_pin_;
  uint8_t current_target_number_ = 0;

  pw::async2::SingleFutureProvider<Pn532DetectTagFuture> detect_provider_;
  pw::async2::SingleFutureProvider<Pn532TransceiveFuture> transceive_provider_;
  pw::async2::SingleFutureProvider<Pn532CheckPresentFuture>
      check_present_provider_;
};

}  // namespace maco::nfc
