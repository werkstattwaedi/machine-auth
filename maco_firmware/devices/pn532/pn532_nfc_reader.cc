// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/devices/pn532/pn532_nfc_reader.h"

#include <cstring>

#include "maco_firmware/devices/pn532/pn532_command.h"
#include "maco_firmware/devices/pn532/pn532_constants.h"
#include "pw_assert/check.h"
#include "pw_log/log.h"
#include "pw_thread/sleep.h"

namespace maco::nfc {

using namespace std::chrono_literals;
using namespace pn532;

//=============================================================================
// Simple tag implementation for Pn532NfcReader
//=============================================================================

/// Internal tag implementation for PN532-detected tags.
class Pn532Tag : public NfcTag {
 public:
  explicit Pn532Tag(const TagInfo& info) : info_(info) {}

  pw::ConstByteSpan uid() const override {
    return pw::ConstByteSpan(info_.uid.data(), info_.uid_length);
  }

  uint8_t sak() const override { return info_.sak; }

  uint8_t target_number() const override { return info_.target_number; }

  bool supports_iso14443_4() const override {
    return info_.supports_iso14443_4;
  }

 private:
  TagInfo info_;
};

//=============================================================================
// Constructor
//=============================================================================

Pn532NfcReader::Pn532NfcReader(pw::stream::ReaderWriter& uart,
                               pw::digital_io::DigitalOut& reset_pin,
                               const Pn532ReaderConfig& config)
    : uart_(uart), reset_pin_(reset_pin), config_(config) {}

//=============================================================================
// NfcReader Interface Implementation
//=============================================================================

pw::Status Pn532NfcReader::Init() {
  InitFsm();
  return DoInit();
}

void Pn532NfcReader::Start(pw::async2::Dispatcher& dispatcher) {
  dispatcher_ = &dispatcher;
  dispatcher.Post(reader_task_);
  fsm_.receive(MsgStart{});
}

TransceiveFuture Pn532NfcReader::RequestTransceive(
    pw::ConstByteSpan command,
    pw::ByteSpan response_buffer,
    pw::chrono::SystemClock::duration timeout) {
  // Store the request
  pending_request_.emplace();
  pending_request_->command = command;
  pending_request_->response_buffer = response_buffer;
  pending_request_->timeout = timeout;

  // Send FSM message
  fsm_.receive(MsgAppRequest{&*pending_request_});

  // Return a future that will be resolved when operation completes
  return transceive_result_provider_.Get();
}

EventFuture Pn532NfcReader::SubscribeOnce() {
  return event_provider_.Get();
}

//=============================================================================
// Internal Methods (called by FSM states)
//=============================================================================

void Pn532NfcReader::StartDetection() {
  detect_future_.emplace(DoDetectTag(config_.detection_timeout));
}

void Pn532NfcReader::StartProbe(const TagInfo& info) {
  pending_tag_info_ = info;
  current_target_number_ = info.target_number;
  // For now, complete probe immediately (no additional probing needed)
  // In the future, this could do SELECT, RATS, etc.
  auto tag = CompleteProbe();
  fsm_.receive(MsgProbeComplete{tag});
}

std::shared_ptr<NfcTag> Pn532NfcReader::CompleteProbe() {
  PW_CHECK(pending_tag_info_.has_value());
  auto tag = std::make_shared<Pn532Tag>(*pending_tag_info_);
  pending_tag_info_.reset();
  return tag;
}

void Pn532NfcReader::OnTagProbed(std::shared_ptr<NfcTag> tag) {
  current_tag_ = std::move(tag);
}

void Pn532NfcReader::SendTagArrived() {
  NfcEvent event{NfcEventType::kTagArrived, current_tag_};
  event_provider_.Resolve(std::move(event));
  // Immediately complete the event sending (no async wait needed)
  fsm_.receive(MsgEventSent{});
}

void Pn532NfcReader::SendTagDeparted() {
  NfcEvent event{NfcEventType::kTagDeparted, current_tag_};
  event_provider_.Resolve(std::move(event));
  current_tag_.reset();
  // Immediately complete the event sending
  fsm_.receive(MsgEventSent{});
}

void Pn532NfcReader::SchedulePresenceCheck() {
  next_presence_check_ =
      pw::chrono::SystemClock::now() + config_.presence_check_interval;
}

void Pn532NfcReader::StartPresenceCheck() {
  check_future_.emplace(DoCheckTagPresent(config_.presence_check_timeout));
}

void Pn532NfcReader::StartOperation(TransceiveRequest* request) {
  transceive_future_.emplace(DoTransceive(
      request->command, request->response_buffer, request->timeout));
}

void Pn532NfcReader::OnOperationComplete(pw::Result<size_t> result) {
  transceive_result_provider_.Resolve(result);
  pending_request_.reset();
}

void Pn532NfcReader::OnOperationFailed() {
  transceive_result_provider_.Resolve(pw::Status::Internal());
  pending_request_.reset();
}

void Pn532NfcReader::OnTagRemoved() {
  if (current_tag_) {
    current_tag_->Invalidate();
  }
  (void)DoReleaseTag(current_target_number_);
  current_target_number_ = 0;
}

void Pn532NfcReader::HandleDesync() { (void)RecoverFromDesync(); }

//=============================================================================
// FSM Setup
//=============================================================================

void Pn532NfcReader::InitFsm() {
  // Initialize state instances
  states_[Pn532StateId::kIdle] = &state_idle_;
  states_[Pn532StateId::kDetecting] = &state_detecting_;
  states_[Pn532StateId::kProbing] = &state_probing_;
  states_[Pn532StateId::kSendingEvent] = &state_sending_event_;
  states_[Pn532StateId::kTagPresent] = &state_tag_present_;
  states_[Pn532StateId::kCheckingPresence] = &state_checking_presence_;
  states_[Pn532StateId::kExecutingOp] = &state_executing_op_;

  fsm_.reader = this;
  fsm_.set_states(states_, Pn532StateId::kNumberOfStates);
  fsm_.start();
}

//=============================================================================
// ReaderTask Implementation
//=============================================================================

pw::async2::Poll<> Pn532NfcReader::ReaderTask::DoPend(pw::async2::Context& cx) {
  auto& reader = parent_;
  auto state = reader.GetState();

  switch (state) {
    case Pn532StateId::kIdle:
      // Nothing to poll
      break;

    case Pn532StateId::kDetecting:
      if (reader.detect_future_.has_value()) {
        auto poll = reader.detect_future_->DoPend(cx);
        if (poll.IsReady()) {
          auto result = std::move(poll.value());
          reader.detect_future_.reset();
          if (result.ok()) {
            reader.fsm_.receive(MsgTagDetected{result.value()});
          } else {
            reader.fsm_.receive(MsgTagNotFound{});
          }
        }
      }
      break;

    case Pn532StateId::kProbing:
      // Probe is done synchronously in StartProbe for now
      break;

    case Pn532StateId::kSendingEvent:
      // Event sending is done synchronously
      break;

    case Pn532StateId::kTagPresent:
      // Check for pending transceive request (handled by FSM message)
      // Check if presence check timer expired
      if (pw::chrono::SystemClock::now() >= reader.next_presence_check_) {
        reader.fsm_.receive(MsgPresenceCheckDue{});
      }
      break;

    case Pn532StateId::kCheckingPresence:
      if (reader.check_future_.has_value()) {
        auto poll = reader.check_future_->DoPend(cx);
        if (poll.IsReady()) {
          auto result = std::move(poll.value());
          reader.check_future_.reset();
          if (result.ok() && result.value()) {
            reader.fsm_.receive(MsgTagPresent{});
          } else {
            reader.fsm_.receive(MsgTagGone{});
          }
        }
      }
      break;

    case Pn532StateId::kExecutingOp:
      if (reader.transceive_future_.has_value()) {
        auto poll = reader.transceive_future_->DoPend(cx);
        if (poll.IsReady()) {
          auto result = std::move(poll.value());
          reader.transceive_future_.reset();
          if (result.ok()) {
            reader.fsm_.receive(MsgOpComplete{result});
          } else {
            reader.fsm_.receive(MsgOpFailed{});
          }
        }
      }
      break;

    default:
      break;
  }

  // Task runs continuously
  cx.ReEnqueue();
  return pw::async2::Pending();
}

//=============================================================================
// Driver Methods (merged from Pn532Driver)
//=============================================================================

pw::Status Pn532NfcReader::DoInit() {
  PW_TRY(DoReset());

  // After reset, SAMConfiguration must be executed first
  // Mode=1 (normal), timeout=0x14 (1 second), IRQ=1
  std::array<std::byte, 3> sam_params = {
      std::byte{0x01}, std::byte{0x14}, std::byte{0x01}};
  std::array<std::byte, 1> response;

  auto result = SendCommandAndReceiveBlocking(
      kCmdSamConfiguration, sam_params, response, kDefaultTimeout);
  if (!result.ok()) {
    return result.status();
  }

  // Verify firmware version
  std::array<std::byte, 4> fw_response;
  result = SendCommandAndReceiveBlocking(
      kCmdGetFirmwareVersion, {}, fw_response, kDefaultTimeout);
  if (!result.ok()) {
    return result.status();
  }

  // Configure RF parameters for better reliability
  // CfgItem=0x05: MaxRtyCOM (max retries for communication)
  std::array<std::byte, 2> rf_params = {std::byte{0x05}, std::byte{0x01}};
  (void)SendCommandAndReceiveBlocking(
      kCmdRfConfiguration, rf_params, response, kDefaultTimeout);

  return pw::OkStatus();
}

pw::Status Pn532NfcReader::DoReset() {
  // Hardware reset: active low, hold for 20ms (matching old firmware)
  PW_TRY(reset_pin_.SetState(pw::digital_io::State::kInactive));
  pw::this_thread::sleep_for(20ms);
  PW_TRY(reset_pin_.SetState(pw::digital_io::State::kActive));
  pw::this_thread::sleep_for(10ms);

  // 6.3.2.3 Case of PN532 in Power Down mode
  // HSU wake up condition: the real waking up condition is the 5th rising edge
  // on the serial line, hence send first a 0x55 dummy byte (01010101 = 4 edges)
  PW_TRY(uart_.Write(kWakeupByte));

  // T_osc_start: typically a few 100µs, up to 2ms
  pw::this_thread::sleep_for(2ms);

  return pw::OkStatus();
}

bool Pn532NfcReader::IsBusy() const {
  // Check if any provider has a pending future
  auto& self = const_cast<Pn532NfcReader&>(*this);
  return self.detect_provider_.has_future() ||
         self.transceive_provider_.has_future() ||
         self.check_present_provider_.has_future();
}

Pn532DetectTagFuture Pn532NfcReader::DoDetectTag(
    pw::chrono::SystemClock::duration timeout) {
  PW_CHECK(!IsBusy(),
           "PN532 can only process one command at a time. "
           "Use AwaitIdle() to wait for the current operation to complete.");
  auto deadline = pw::chrono::SystemClock::now() + timeout;
  return Pn532DetectTagFuture(detect_provider_, *this, deadline);
}

Pn532TransceiveFuture Pn532NfcReader::DoTransceive(
    pw::ConstByteSpan command,
    pw::ByteSpan response_buffer,
    pw::chrono::SystemClock::duration timeout) {
  PW_CHECK(!IsBusy(),
           "PN532 can only process one command at a time. "
           "Use AwaitIdle() to wait for the current operation to complete.");
  auto deadline = pw::chrono::SystemClock::now() + timeout;
  return Pn532TransceiveFuture(
      transceive_provider_, *this, command, response_buffer, deadline);
}

Pn532CheckPresentFuture Pn532NfcReader::DoCheckTagPresent(
    pw::chrono::SystemClock::duration timeout) {
  PW_CHECK(!IsBusy(),
           "PN532 can only process one command at a time. "
           "Use AwaitIdle() to wait for the current operation to complete.");
  auto deadline = pw::chrono::SystemClock::now() + timeout;
  return Pn532CheckPresentFuture(check_present_provider_, *this, deadline);
}

pw::Status Pn532NfcReader::DoReleaseTag(uint8_t target_number) {
  // This uses blocking I/O, acceptable for release (cleanup operation)
  std::array<std::byte, 1> params = {std::byte{target_number}};
  std::array<std::byte, 1> response;

  auto result = SendCommandAndReceiveBlocking(
      kCmdInRelease, params, response, kDefaultTimeout);
  if (!result.ok()) {
    return result.status();
  }

  current_target_number_ = 0;
  return pw::OkStatus();
}

pw::Status Pn532NfcReader::RecoverFromDesync() {
  // Send ACK to abort any pending command
  PW_TRY(uart_.Write(kAckFrame));

  // Drain UART buffer
  DrainReceiveBuffer();

  return pw::OkStatus();
}

void Pn532NfcReader::DrainReceiveBuffer() {
  std::array<std::byte, 64> discard;
  while (true) {
    auto result = uart_.Read(discard);
    if (!result.ok() || result.value().empty()) {
      break;
    }
  }
}

//=============================================================================
// Init-Only Blocking Helpers
//=============================================================================

pw::Status Pn532NfcReader::WriteFrameBlocking(uint8_t command,
                                              pw::ConstByteSpan params) {
  std::array<std::byte, 265> tx_buffer;
  Pn532Command cmd{command, params};
  size_t frame_len = cmd.BuildFrame(tx_buffer);
  if (frame_len == 0) {
    return pw::Status::OutOfRange();
  }
  return uart_.Write(pw::ConstByteSpan(tx_buffer.data(), frame_len));
}

pw::Status Pn532NfcReader::WaitForAckBlocking(
    pw::chrono::SystemClock::duration timeout) {
  // Read 6 bytes for ACK frame
  std::array<std::byte, 6> ack_buffer;
  size_t bytes_read = 0;

  auto deadline = pw::chrono::SystemClock::now() + timeout;

  while (bytes_read < ack_buffer.size()) {
    if (pw::chrono::SystemClock::now() >= deadline) {
      return pw::Status::DeadlineExceeded();
    }

    auto result =
        uart_.Read(pw::ByteSpan(ack_buffer.data() + bytes_read,
                                ack_buffer.size() - bytes_read));
    if (result.ok() && !result.value().empty()) {
      bytes_read += result.value().size();
    } else {
      pw::this_thread::sleep_for(1ms);
    }
  }

  // Verify ACK
  if (std::memcmp(ack_buffer.data(), kAckFrame.data(), kAckFrame.size()) != 0) {
    return pw::Status::DataLoss();
  }

  return pw::OkStatus();
}

pw::Result<size_t> Pn532NfcReader::ReadFrameBlocking(
    uint8_t expected_command,
    pw::ByteSpan response_buffer,
    pw::chrono::SystemClock::duration timeout) {
  auto deadline = pw::chrono::SystemClock::now() + timeout;

  // Helper to read bytes with timeout
  auto read_bytes = [&](pw::ByteSpan buffer) -> pw::Status {
    size_t bytes_read = 0;
    while (bytes_read < buffer.size()) {
      if (pw::chrono::SystemClock::now() >= deadline) {
        return pw::Status::DeadlineExceeded();
      }
      auto result = uart_.Read(
          pw::ByteSpan(buffer.data() + bytes_read, buffer.size() - bytes_read));
      if (result.ok() && !result.value().empty()) {
        bytes_read += result.value().size();
      } else {
        pw::this_thread::sleep_for(1ms);
      }
    }
    return pw::OkStatus();
  };

  // Read and validate start sequence (may need to scan)
  if (!ScanForStartSequenceBlocking(timeout)) {
    return pw::Status::DeadlineExceeded();
  }

  // Read LEN and LCS
  std::array<std::byte, 2> len_buf;
  PW_TRY(read_bytes(len_buf));

  uint8_t len = static_cast<uint8_t>(len_buf[0]);
  uint8_t lcs = static_cast<uint8_t>(len_buf[1]);

  if (!Pn532Command::ValidateLengthChecksum(len, lcs)) {
    return pw::Status::DataLoss();
  }

  // Read TFI + data + DCS + postamble
  if (len > kMaxFrameLength) {
    return pw::Status::OutOfRange();
  }

  std::array<std::byte, kMaxFrameLength + 2> data_buf;  // +2 for DCS+postamble
  PW_TRY(read_bytes(pw::ByteSpan(data_buf.data(), len + 2)));

  // Validate TFI
  std::byte tfi = data_buf[0];
  if (tfi == kTfiError) {
    return pw::Status::Internal();
  }
  if (tfi != kTfiPn532ToHost) {
    return pw::Status::DataLoss();
  }

  // Validate response command
  uint8_t response_cmd = static_cast<uint8_t>(data_buf[1]);
  if (response_cmd != expected_command + 1) {
    return pw::Status::DataLoss();
  }

  // Validate DCS
  uint8_t dcs = static_cast<uint8_t>(data_buf[len]);
  if (!Pn532Command::ValidateDataChecksum(
          pw::ConstByteSpan(data_buf.data(), len), dcs)) {
    return pw::Status::DataLoss();
  }

  // Copy response data (excluding TFI and command byte)
  size_t data_len = len - 2;  // Subtract TFI and command
  if (data_len > response_buffer.size()) {
    return pw::Status::ResourceExhausted();
  }

  std::memcpy(response_buffer.data(), &data_buf[2], data_len);
  return data_len;
}

pw::Result<size_t> Pn532NfcReader::SendCommandAndReceiveBlocking(
    uint8_t command,
    pw::ConstByteSpan params,
    pw::ByteSpan response_buffer,
    pw::chrono::SystemClock::duration timeout) {
  PW_TRY(WriteFrameBlocking(command, params));
  PW_TRY(WaitForAckBlocking(kDefaultTimeout));
  return ReadFrameBlocking(command, response_buffer, timeout);
}

bool Pn532NfcReader::ScanForStartSequenceBlocking(
    pw::chrono::SystemClock::duration timeout) {
  auto deadline = pw::chrono::SystemClock::now() + timeout;

  // Look for 0x00 0xFF sequence
  int state = 0;  // 0=looking for 0x00, 1=looking for 0xFF

  while (pw::chrono::SystemClock::now() < deadline) {
    std::array<std::byte, 1> buf;
    auto result = uart_.Read(buf);
    if (!result.ok() || result.value().empty()) {
      pw::this_thread::sleep_for(1ms);
      continue;
    }

    uint8_t b = static_cast<uint8_t>(buf[0]);
    if (state == 0) {
      if (b == 0x00) {
        state = 1;
      }
    } else {
      if (b == 0xFF) {
        return true;  // Found start sequence
      } else if (b != 0x00) {
        state = 0;  // Reset
      }
      // If b == 0x00, stay in state 1 (could be preamble)
    }
  }

  return false;
}

}  // namespace maco::nfc
