// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <optional>

#include "maco_firmware/devices/pn532/pn532_check_present_future.h"
#include "maco_firmware/devices/pn532/pn532_detect_tag_future.h"
#include "maco_firmware/devices/pn532/pn532_nfc_reader_fsm.h"
#include "maco_firmware/devices/pn532/pn532_transceive_future.h"
#include "maco_firmware/modules/nfc_reader/nfc_error.h"
#include "maco_firmware/modules/nfc_reader/nfc_event.h"
#include "maco_firmware/modules/nfc_reader/nfc_reader.h"
#include "maco_firmware/devices/pn532/tag_info.h"
#include "maco_firmware/modules/nfc_reader/transceive_request.h"
#include "maco_firmware/modules/nfc_tag/nfc_tag.h"
#include "pw_async2/dispatcher.h"
#include "pw_async2/task.h"
#include "pw_async2/value_future.h"
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

/// PN532-based NFC reader implementation.
///
/// This class merges the PN532 driver functionality with the NfcReader
/// interface. It runs as an async task that:
/// - Detects tags automatically
/// - Probes tag type
/// - Performs presence checks
/// - Handles application transceive requests
///
/// All NFC operations are non-blocking and driven by an internal Task
/// that polls futures and drives the FSM.
class Pn532NfcReader : public NfcReader {
 public:
  /// Default timeout at 115200 baud per PN532 User Manual Section 6.2.2
  static constexpr auto kDefaultTimeout = std::chrono::milliseconds(89);

  /// Construct a PN532 NFC reader.
  /// @param uart UART stream for communication (must be configured for 115200
  /// baud)
  /// @param reset_pin Reset pin (active low)
  /// @param config Configuration for timing parameters
  Pn532NfcReader(pw::stream::ReaderWriter& uart,
                 pw::digital_io::DigitalOut& reset_pin,
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

  // -- Internal Methods (called by FSM states) --

  void StartDetection();
  void StartProbe(const TagInfo& info);
  std::shared_ptr<NfcTag> CompleteProbe();
  void OnTagProbed(std::shared_ptr<NfcTag> tag);
  void SendTagArrived();
  void SendTagDeparted();
  void SchedulePresenceCheck();
  void StartPresenceCheck();
  void StartOperation(TransceiveRequest* request);
  void OnOperationComplete(pw::Result<size_t> result);
  void OnOperationFailed();
  void OnTagRemoved();
  void HandleDesync();

  // -- State Accessors --

  Pn532StateId GetState() const {
    return static_cast<Pn532StateId>(fsm_.get_state_id());
  }

  // -- Driver Accessors (used by futures) --

  /// Get UART stream for frame I/O.
  pw::stream::ReaderWriter& uart() { return uart_; }

  /// Check if a driver operation is in progress.
  bool IsBusy() const;

  /// Get current target number for commands.
  uint8_t current_target_number() const { return current_target_number_; }

  /// Set current target number (called by futures after detection).
  void set_current_target_number(uint8_t target) {
    current_target_number_ = target;
  }

  /// Drain the UART receive buffer (used by futures after timeout).
  void DrainReceiveBuffer();

 protected:
  // -- Driver Methods (protected for testing) --

  pw::Status DoInit();
  pw::Status DoReset();
  Pn532DetectTagFuture DoDetectTag(pw::chrono::SystemClock::duration timeout);
  Pn532TransceiveFuture DoTransceive(
      pw::ConstByteSpan command,
      pw::ByteSpan response_buffer,
      pw::chrono::SystemClock::duration timeout);
  Pn532CheckPresentFuture DoCheckTagPresent(
      pw::chrono::SystemClock::duration timeout);
  pw::Status DoReleaseTag(uint8_t target_number);
  pw::Status RecoverFromDesync();

 private:
  /// Inner Task for async polling - drives the FSM
  class ReaderTask : public pw::async2::Task {
   public:
    explicit ReaderTask(Pn532NfcReader& parent) : parent_(parent) {}

   private:
    pw::async2::Poll<> DoPend(pw::async2::Context& cx) override;
    Pn532NfcReader& parent_;
  };

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

  // -- FSM Setup --

  void InitFsm();

  // -- Members --

  // Hardware
  pw::stream::ReaderWriter& uart_;
  pw::digital_io::DigitalOut& reset_pin_;
  Pn532ReaderConfig config_;

  // Async task
  ReaderTask reader_task_{*this};
  pw::async2::Dispatcher* dispatcher_ = nullptr;

  // FSM and state instances
  Pn532NfcReaderFsm fsm_;
  Pn532StateIdle state_idle_;
  Pn532StateDetecting state_detecting_;
  Pn532StateProbing state_probing_;
  Pn532StateSendingEvent state_sending_event_;
  Pn532StateTagPresent state_tag_present_;
  Pn532StateCheckingPresence state_checking_presence_;
  Pn532StateExecutingOp state_executing_op_;
  etl::ifsm_state* states_[Pn532StateId::kNumberOfStates]{};

  // Tag state
  std::shared_ptr<NfcTag> current_tag_;
  std::optional<TagInfo> pending_tag_info_;
  uint8_t current_target_number_ = 0;

  // Active futures
  std::optional<Pn532DetectTagFuture> detect_future_;
  std::optional<Pn532CheckPresentFuture> check_future_;
  std::optional<Pn532TransceiveFuture> transceive_future_;

  // Future providers (enforce single operation)
  pw::async2::SingleFutureProvider<Pn532DetectTagFuture> detect_provider_;
  pw::async2::SingleFutureProvider<Pn532TransceiveFuture> transceive_provider_;
  pw::async2::SingleFutureProvider<Pn532CheckPresentFuture>
      check_present_provider_;

  // Pending transceive request from application
  std::optional<TransceiveRequest> pending_request_;
  pw::async2::ValueProvider<pw::Result<size_t>> transceive_result_provider_;

  // Event subscription
  pw::async2::ValueProvider<NfcEvent> event_provider_;

  // Presence check timing
  pw::chrono::SystemClock::time_point next_presence_check_;
};

}  // namespace maco::nfc
