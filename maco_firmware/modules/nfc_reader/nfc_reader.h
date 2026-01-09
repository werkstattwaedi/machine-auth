// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <memory>
#include <optional>

#include "maco_firmware/modules/nfc_reader/nfc_error.h"
#include "maco_firmware/modules/nfc_reader/nfc_event.h"
#include "maco_firmware/modules/nfc_reader/nfc_reader_driver.h"
#include "maco_firmware/modules/nfc_reader/nfc_reader_events.h"
#include "maco_firmware/modules/nfc_reader/nfc_reader_fsm.h"
#include "maco_firmware/modules/nfc_reader/transceive_request.h"
#include "maco_firmware/modules/nfc_tag/iso14443_tag.h"
#include "maco_firmware/modules/nfc_tag/nfc_tag.h"
#include "pw_async2/channel.h"
#include "pw_async2/dispatcher.h"
#include "pw_async2/poll.h"
#include "pw_chrono/system_clock.h"
#include "pw_log/log.h"
#include "pw_result/result.h"
#include "pw_status/status.h"
#include "pw_status/try.h"

namespace maco::nfc {
using namespace std::chrono_literals;

// Forward declaration for TransceiveRequest
struct TransceiveRequest;

/// Timing constants for NFC operations.
struct NfcReaderConfig {
  /// Timeout for tag detection attempts.
  pw::chrono::SystemClock::duration detection_timeout = 500ms;

  /// Interval between presence checks when tag is present.
  pw::chrono::SystemClock::duration presence_check_interval = 200ms;

  /// Timeout for presence check operations.
  pw::chrono::SystemClock::duration presence_check_timeout = 100ms;

  /// Default timeout for transceive operations.
  pw::chrono::SystemClock::duration default_transceive_timeout = 1000ms;
};

/// Async NFC Reader as a pw_async2 Task.
///
/// Runs continuously after Init(), managing:
/// - Tag detection (InListPassiveTarget)
/// - Tag type probing (SELECT commands)
/// - Presence checking (Diagnose attention request)
/// - Application transceive operations
///
/// Notifies application of tag arrival/departure via pw_async2 channel.
///
/// @tparam Driver NFC driver type implementing NfcReaderDriverBase
template <typename Driver>
class NfcReader {
 public:
  /// Construct an NFC reader without event notification.
  /// @param driver Reference to the NFC driver
  /// @param config Configuration for timing parameters
  explicit NfcReader(
      Driver& driver, const NfcReaderConfig& config = NfcReaderConfig()
  )
      : driver_(driver), config_(config) {
    InitFsm();
  }

  /// Construct an NFC reader with event notification.
  /// @param driver Reference to the NFC driver
  /// @param event_sender Sender for tag arrival/departure events
  /// @param config Configuration for timing parameters
  NfcReader(
      Driver& driver,
      pw::async2::Sender<NfcEvent> event_sender,
      const NfcReaderConfig& config = NfcReaderConfig()
  )
      : driver_(driver),
        config_(config),
        event_sender_(std::move(event_sender)) {
    InitFsm();
  }

  /// Initialize the reader and driver.
  pw::Status Init() {
    PW_TRY(driver_.Init());
    return pw::OkStatus();
  }

  /// Get the current tag, if present.
  /// @return Shared pointer to tag, or nullptr if no tag
  std::shared_ptr<NfcTag> GetCurrentTag() { return current_tag_; }

  /// Get the current tag as a specific type.
  /// @tparam T Tag type to cast to
  /// @return Shared pointer to tag, or nullptr if no tag or wrong type
  template <typename T>
  std::shared_ptr<T> GetTagAs() {
    return std::dynamic_pointer_cast<T>(current_tag_);
  }

  /// Check if a tag is currently present.
  bool HasTag() const { return current_tag_ != nullptr; }

  /// Request a transceive operation to be executed by the reader.
  ///
  /// This method is called by tags to execute operations. The request is
  /// queued and processed by the FSM when in the TagPresent state.
  ///
  /// @param command Command bytes to send
  /// @param response_buffer Buffer for response data
  /// @param timeout Maximum time to wait for response
  /// @return Future that resolves when operation completes
  TransceiveRequestFuture RequestTransceive(
      pw::ConstByteSpan command,
      pw::ByteSpan response_buffer,
      pw::chrono::SystemClock::duration timeout
  ) {
    pending_request_.emplace(
        TransceiveRequest{
            .command = command,
            .response_buffer = response_buffer,
            .timeout = timeout,
            .result = std::nullopt,
            .completed = false
        }
    );
    return TransceiveRequestFuture(&*pending_request_);
  }

  /// Get the current FSM state (for debugging/testing).
  NfcReaderStateId GetState() const {
    return static_cast<NfcReaderStateId>(fsm_.get_state_id());
  }

  // -- Methods called by FSM states --

  /// Start tag detection.
  void StartDetection() {
    detect_future_.emplace(driver_.DetectTag(config_.detection_timeout));
  }

  /// Start tag type probing after detection.
  /// Called from StateDetecting when a tag is detected.
  void StartProbe(const TagInfo& info) {
    // Store the tag info for probing (actual probe happens in CompleteProbe)
    pending_tag_info_ = info;
  }

  /// Complete the probing process and create the tag.
  /// Called from PollOnce when in Probing state.
  /// Returns the created tag for the FSM to pass to OnTagProbed.
  std::shared_ptr<NfcTag> CompleteProbe() {
    if (pending_tag_info_) {
      // TODO: Implement actual probing with SELECT commands
      // For now, create an ISO 14443 tag immediately
      auto tag = std::make_shared<Iso14443Tag<Driver>>(
          *this, driver_, *pending_tag_info_
      );
      pending_tag_info_.reset();
      return tag;
    }
    return nullptr;
  }

  /// Called when tag probing is complete.
  void OnTagProbed(std::shared_ptr<NfcTag> tag) {
    current_tag_ = std::move(tag);
    PW_LOG_INFO(
        "Tag arrived: UID length=%zu, SAK=0x%02X",
        current_tag_->uid_length(),
        current_tag_->sak()
    );
    // Note: SendTagArrived is called by StateSendingEvent::on_enter_state
  }

  /// Send a TagArrived event to the application.
  ///
  /// Uses TrySend for non-blocking behavior. If the channel is full,
  /// the event is dropped (application should be consuming events).
  void SendTagArrived() {
    if (event_sender_) {
      NfcEvent event{NfcEventType::kTagArrived, current_tag_};
      (void)event_sender_->TrySend(std::move(event));
    }
    // Signal event sent regardless of success (FSM must proceed)
    fsm_.receive(MsgEventSent());
  }

  /// Send a TagDeparted event to the application.
  ///
  /// Uses TrySend for non-blocking behavior. If the channel is full,
  /// the event is dropped (application should be consuming events).
  void SendTagDeparted() {
    if (event_sender_) {
      NfcEvent event{NfcEventType::kTagDeparted, nullptr};
      (void)event_sender_->TrySend(std::move(event));
    }
    // Signal event sent regardless of success (FSM must proceed)
    fsm_.receive(MsgEventSent());
  }

  /// Schedule the next presence check.
  void SchedulePresenceCheck() {
    next_presence_check_ =
        pw::chrono::SystemClock::now() + config_.presence_check_interval;
  }

  /// Force presence check to be due immediately (for testing).
  /// After calling this, the next PollOnce() will trigger a presence check.
  void ForcePresenceCheckDue() {
    next_presence_check_ =
        pw::chrono::SystemClock::now() - std::chrono::milliseconds(1);
  }

  /// Start a presence check operation.
  void StartPresenceCheck() {
    check_future_.emplace(driver_.CheckTagPresent(config_.presence_check_timeout
    ));
  }

  /// Start an application-requested transceive operation.
  void StartOperation(TransceiveRequest* request) {
    // TODO: Implement when TransceiveRequest is defined
    (void)request;
  }

  /// Called when an operation completes successfully or with recoverable error.
  void OnOperationComplete(pw::Result<size_t> result) {
    // TODO: Deliver result to pending request
    (void)result;
  }

  /// Called when an operation fails with tag-gone error.
  void OnOperationFailed() {
    // TODO: Fail pending request with Unavailable
    // Then handle tag removal
    OnTagRemoved();
  }

  /// Called when tag is confirmed gone.
  /// Note: SendTagDeparted is called by StateSendingEvent::on_enter_state
  void OnTagRemoved() {
    if (current_tag_) {
      uint8_t target = current_tag_->target_number();
      current_tag_->Invalidate();
      current_tag_.reset();

      // Release tag in PN532 (cleans up internal state)
      (void)driver_.ReleaseTag(target);

      PW_LOG_INFO("Tag departed");
    }
  }

  /// Handle protocol desync by recovering and forcing state.
  void HandleDesync() {
    // Fix PN532 communication
    (void)driver_.RecoverFromDesync();

    // Clear any in-flight futures
    detect_future_.reset();
    check_future_.reset();
    transceive_future_.reset();

    // TODO: Fail any pending app request with Aborted
  }

  /// Poll all active futures and generate FSM events.
  /// Called from the main application loop.
  /// @return true if any work was done
  bool PollOnce() {
    bool did_work = false;

    // Poll detect future
    if (detect_future_) {
      if (detect_future_->IsReady()) {
        auto result = detect_future_->Take();
        detect_future_.reset();
        did_work = true;

        if (result.ok()) {
          fsm_.receive(MsgTagDetected(result.value()));
        } else if (IsDesyncError(result.status())) {
          HandleDesync();
          // No tag context, go to idle
          fsm_.reset();
          fsm_.start();
        } else {
          fsm_.receive(MsgTagNotFound());
        }
      }
    }

    // Poll presence check future
    if (check_future_) {
      if (check_future_->IsReady()) {
        auto result = check_future_->Take();
        check_future_.reset();
        did_work = true;

        if (result.ok() && result.value()) {
          fsm_.receive(MsgTagPresent());
        } else if (IsDesyncError(result.status())) {
          HandleDesync();
          if (current_tag_) {
            // Had a tag - force presence check
            StartPresenceCheck();
          } else {
            fsm_.reset();
            fsm_.start();
          }
        } else {
          fsm_.receive(MsgTagGone());
        }
      }
    }

    // Poll transceive future
    if (transceive_future_) {
      if (transceive_future_->IsReady()) {
        auto result = transceive_future_->Take();
        transceive_future_.reset();
        did_work = true;

        if (result.ok()) {
          fsm_.receive(MsgOpComplete(result));
        } else if (IsDesyncError(result.status())) {
          HandleDesync();
          if (current_tag_) {
            StartPresenceCheck();
          } else {
            fsm_.reset();
            fsm_.start();
          }
        } else if (IsTagGoneError(result.status())) {
          fsm_.receive(MsgOpFailed());
        } else {
          // Recoverable error - deliver to app
          fsm_.receive(MsgOpComplete(result));
        }
      }
    }

    // Check presence timer when in TagPresent state
    if (GetState() == NfcReaderStateId::kTagPresent) {
      if (pw::chrono::SystemClock::now() >= next_presence_check_) {
        fsm_.receive(MsgPresenceCheckDue());
        did_work = true;
      }
    }

    // Handle immediate state transitions (for synchronous operations)
    if (GetState() == NfcReaderStateId::kProbing) {
      // Complete probing immediately (no async SELECT commands yet)
      auto tag = CompleteProbe();
      if (tag) {
        fsm_.receive(MsgProbeComplete(tag));
      } else {
        fsm_.receive(MsgProbeFailed());
      }
      did_work = true;
    }

    if (GetState() == NfcReaderStateId::kSendingEvent) {
      // Send the appropriate event
      if (HasTag()) {
        SendTagArrived();
      } else {
        SendTagDeparted();
      }
      did_work = true;
    }

    return did_work;
  }

  /// Start the FSM (call after Init).
  void Start() {
    fsm_.reset();
    fsm_.start();
  }

 private:
  /// Initialize the ETL FSM with state instances.
  void InitFsm() {
    // Set reader reference on FSM (states access it via get_fsm_context())
    fsm_.reader = this;

    // Initialize state pointer array (must be member to outlive function)
    states_[0] = &state_idle_;
    states_[1] = &state_detecting_;
    states_[2] = &state_probing_;
    states_[3] = &state_sending_event_;
    states_[4] = &state_tag_present_;
    states_[5] = &state_checking_presence_;
    states_[6] = &state_executing_op_;

    // Register states with FSM
    fsm_.set_states(states_, NfcReaderStateId::kNumberOfStates);
  }

  Driver& driver_;
  NfcReaderConfig config_;
  std::optional<pw::async2::Sender<NfcEvent>> event_sender_;
  std::shared_ptr<NfcTag> current_tag_;

  // ETL FSM and state instances (states must outlive FSM)
  NfcReaderFsm<Driver> fsm_;
  StateIdle<Driver> state_idle_;
  StateDetecting<Driver> state_detecting_;
  StateProbing<Driver> state_probing_;
  StateSendingEvent<Driver> state_sending_event_;
  StateTagPresent<Driver> state_tag_present_;
  StateCheckingPresence<Driver> state_checking_presence_;
  StateExecutingOp<Driver> state_executing_op_;

  // State pointer array for FSM registration (must be member, not local)
  etl::ifsm_state* states_[NfcReaderStateId::kNumberOfStates]{};

  // Pending tag info during probing
  std::optional<TagInfo> pending_tag_info_;

  // Pending transceive request from application
  std::optional<TransceiveRequest> pending_request_;

  // Active futures
  std::optional<decltype(std::declval<Driver>().DetectTag({}))> detect_future_;
  std::optional<decltype(std::declval<Driver>().CheckTagPresent({}))>
      check_future_;
  std::optional<decltype(std::declval<Driver>().Transceive({}, {}, {}))>
      transceive_future_;

  // Presence check timing
  pw::chrono::SystemClock::time_point next_presence_check_;
};

}  // namespace maco::nfc
