// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Must define PW_LOG_MODULE_NAME before including any headers that use pw_log
#define PW_LOG_MODULE_NAME "pn532"

#include "maco_firmware/devices/pn532/pn532_nfc_reader.h"

#include <cstring>

#include "maco_firmware/devices/pn532/pn532_command.h"
#include "maco_firmware/devices/pn532/pn532_constants.h"
#include "pw_assert/check.h"
#include "pw_log/log.h"
#include "pw_status/try.h"
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
                               pw::allocator::Allocator& alloc,
                               const Pn532ReaderConfig& config)
    : uart_(uart),
      reset_pin_(reset_pin),
      config_(config),
      coro_cx_(alloc) {}

//=============================================================================
// NfcReader Interface Implementation
//=============================================================================

pw::Status Pn532NfcReader::Init() { return DoInit(); }

void Pn532NfcReader::Start(pw::async2::Dispatcher& dispatcher) {
  dispatcher_ = &dispatcher;

  // Create the main loop coroutine
  auto coro = RunLoop(coro_cx_);

  // Wrap with error handler
  reader_task_.emplace(
      std::move(coro), [](pw::Status status) {
        if (!status.ok()) {
          PW_LOG_ERROR("NFC reader coroutine failed: %d",
                       static_cast<int>(status.code()));
        }
      });

  dispatcher.Post(*reader_task_);
}

TransceiveFuture Pn532NfcReader::RequestTransceive(
    pw::ConstByteSpan command,
    pw::ByteSpan response_buffer,
    pw::chrono::SystemClock::duration timeout) {
  // Store the request - the main loop will pick it up
  pending_request_.emplace();
  pending_request_->command = command;
  pending_request_->response_buffer = response_buffer;
  pending_request_->timeout = timeout;

  // Return a future that will be resolved when operation completes
  return transceive_result_provider_.Get();
}

EventFuture Pn532NfcReader::SubscribeOnce() { return event_provider_.Get(); }

//=============================================================================
// Main Loop Coroutine
//=============================================================================

pw::async2::Coro<pw::Status> Pn532NfcReader::RunLoop(
    pw::async2::CoroContext& cx) {
  PW_LOG_INFO("PN532 reader coroutine started");

  while (true) {
    // === DETECTING ===
    PW_LOG_DEBUG("Detecting tag...");
    auto detect_result = co_await DetectTag(cx, config_.detection_timeout);

    if (!detect_result.ok()) {
      // No tag found or error - loop back to detection
      if (detect_result.status().IsNotFound()) {
        PW_LOG_DEBUG("No tag found, retrying...");
      } else {
        PW_LOG_WARN("Detection error: %d",
                    static_cast<int>(detect_result.status().code()));
      }
      continue;
    }

    TagInfo info = *detect_result;
    current_target_number_ = info.target_number;

    // === PROBING ===
    // For now, just create the tag (could add SELECT/RATS here later)
    current_tag_ = std::make_shared<Pn532Tag>(info);
    PW_LOG_INFO("Tag detected: UID=%d bytes, SAK=0x%02x",
                static_cast<int>(info.uid_length), info.sak);

    // === SEND TAG ARRIVED EVENT ===
    event_provider_.Resolve(NfcEvent{NfcEventType::kTagArrived, current_tag_});

    // === TAG PRESENT LOOP ===
    auto next_presence_check =
        pw::chrono::SystemClock::now() + config_.presence_check_interval;

    while (true) {
      // Check if app has a pending transceive request
      if (pending_request_.has_value()) {
        auto& req = *pending_request_;

        PW_LOG_DEBUG("Executing transceive request");
        auto result =
            co_await Transceive(cx, req.command, req.response_buffer, req.timeout);

        transceive_result_provider_.Resolve(result);
        pending_request_.reset();

        // Reset presence check timer after operation
        next_presence_check =
            pw::chrono::SystemClock::now() + config_.presence_check_interval;
        continue;
      }

      // Check if presence check is due
      if (pw::chrono::SystemClock::now() >= next_presence_check) {
        PW_LOG_DEBUG("Checking tag presence");
        auto present_result =
            co_await CheckTagPresent(cx, config_.presence_check_timeout);
        bool present = present_result.ok() && *present_result;

        if (!present) {
          // Tag gone
          PW_LOG_INFO("Tag departed");
          if (current_tag_) {
            current_tag_->Invalidate();
          }
          DrainReceiveBuffer();
          (void)DoReleaseTag(current_target_number_);
          current_target_number_ = 0;

          event_provider_.Resolve(
              NfcEvent{NfcEventType::kTagDeparted, current_tag_});
          current_tag_.reset();
          break;  // Back to detection loop
        }

        // Tag still present, schedule next check
        next_presence_check =
            pw::chrono::SystemClock::now() + config_.presence_check_interval;
      }

      // Short sleep to let other tasks run, then check again.
      // This is a simple polling approach - the UART I/O is poll-based anyway.
      pw::this_thread::sleep_for(10ms);
    }
  }

  co_return pw::OkStatus();
}

//=============================================================================
// SendCommand Coroutine - Core Protocol Handler
//=============================================================================

pw::async2::Coro<pw::Result<pw::ConstByteSpan>> Pn532NfcReader::SendCommand(
    [[maybe_unused]] pw::async2::CoroContext& cx,
    const Pn532Command& cmd,
    pw::chrono::SystemClock::time_point deadline) {
  // Build frame
  size_t frame_len = cmd.BuildFrame(tx_buffer_);
  if (frame_len == 0) {
    co_return pw::Status::OutOfRange();  // Command too large
  }

  // Send frame
  auto write_result = uart_.Write(pw::ConstByteSpan(tx_buffer_.data(), frame_len));
  if (!write_result.ok()) {
    co_return write_result;
  }

  // Wait for ACK (6 bytes)
  size_t ack_received = 0;
  while (ack_received < ack_buffer_.size()) {
    if (pw::chrono::SystemClock::now() >= deadline) {
      co_return pw::Status::DeadlineExceeded();
    }

    auto result = uart_.Read(pw::ByteSpan(ack_buffer_.data() + ack_received,
                                          ack_buffer_.size() - ack_received));
    if (result.ok() && !result.value().empty()) {
      ack_received += result.value().size();
    } else {
      // Short sleep and retry
      pw::this_thread::sleep_for(1ms);
    }
  }

  // Validate ACK
  if (std::memcmp(ack_buffer_.data(), kAckFrame.data(), kAckFrame.size()) != 0) {
    PW_LOG_ERROR("Invalid ACK for cmd 0x%02x", cmd.command);
    co_return pw::Status::DataLoss();
  }

  // Read response frame
  size_t rx_received = 0;
  while (true) {
    if (pw::chrono::SystemClock::now() >= deadline) {
      co_return pw::Status::DeadlineExceeded();
    }

    auto result = uart_.Read(pw::ByteSpan(rx_buffer_.data() + rx_received,
                                          rx_buffer_.size() - rx_received));
    if (result.ok() && !result.value().empty()) {
      rx_received += result.value().size();
    }

    // Need at least 5 bytes to determine frame length
    if (rx_received < 5) {
      pw::this_thread::sleep_for(1ms);
      continue;
    }

    // Find start sequence (0x00 0xFF)
    size_t start_idx = 0;
    bool found_start = false;
    for (size_t i = 0; i + 1 < rx_received; ++i) {
      if (rx_buffer_[i] == std::byte{0x00} &&
          rx_buffer_[i + 1] == std::byte{0xFF}) {
        start_idx = i + 2;  // Point to LEN
        found_start = true;
        break;
      }
    }

    if (!found_start || start_idx + 2 > rx_received) {
      pw::this_thread::sleep_for(1ms);
      continue;
    }

    // Parse length
    uint8_t len = static_cast<uint8_t>(rx_buffer_[start_idx]);
    uint8_t lcs = static_cast<uint8_t>(rx_buffer_[start_idx + 1]);

    if (!Pn532Command::ValidateLengthChecksum(len, lcs)) {
      PW_LOG_ERROR("Invalid LCS for cmd 0x%02x", cmd.command);
      co_return pw::Status::DataLoss();
    }

    // Full frame: start_idx + 2 (len/lcs) + len (data) + 1 (dcs) + 1 (postamble)
    size_t expected_total = start_idx + 2 + len + 2;
    if (rx_received < expected_total) {
      pw::this_thread::sleep_for(1ms);
      continue;
    }

    // Parse response
    auto payload = Pn532Command::ParseResponse(
        cmd.command, pw::ConstByteSpan(rx_buffer_.data(), rx_received));

    if (!payload.ok()) {
      PW_LOG_ERROR("Parse error for cmd 0x%02x: %d", cmd.command,
                   static_cast<int>(payload.status().code()));
    }

    co_return payload;
  }
}

//=============================================================================
// DetectTag Coroutine
//=============================================================================

pw::async2::Coro<pw::Result<TagInfo>> Pn532NfcReader::DetectTag(
    pw::async2::CoroContext& cx,
    pw::chrono::SystemClock::duration timeout) {
  auto deadline = pw::chrono::SystemClock::now() + timeout;

  // InListPassiveTarget: MaxTg=1, BrTy=106kbps Type A
  std::array<std::byte, 2> params = {std::byte{0x01}, std::byte{0x00}};
  Pn532Command cmd{kCmdInListPassiveTarget, params};

  auto result = co_await SendCommand(cx, cmd, deadline);

  // Timeout = no card found
  if (result.status().IsDeadlineExceeded()) {
    (void)uart_.Write(kAckFrame);  // Abort pending command
    DrainReceiveBuffer();
    co_return pw::Status::NotFound();
  }

  if (!result.ok()) {
    DrainReceiveBuffer();
    co_return result.status();
  }

  co_return ParseDetectResponse(*result);
}

pw::Result<TagInfo> Pn532NfcReader::ParseDetectResponse(
    pw::ConstByteSpan payload) {
  // InListPassiveTarget response: [NbTg][Tg][SENS_RES(2)][SEL_RES][NFCIDLength][NFCID...]
  if (payload.empty()) {
    return pw::Status::NotFound();
  }

  uint8_t num_targets = static_cast<uint8_t>(payload[0]);
  if (num_targets == 0) {
    return pw::Status::NotFound();
  }

  // Need at least: NbTg + Tg + SENS_RES(2) + SEL_RES + NFCIDLength = 6 bytes
  if (payload.size() < 6) {
    return pw::Status::DataLoss();
  }

  TagInfo info = {};
  info.target_number = static_cast<uint8_t>(payload[1]);
  info.sak = static_cast<uint8_t>(payload[4]);
  info.uid_length = static_cast<uint8_t>(payload[5]);

  if (info.uid_length > info.uid.size()) {
    return pw::Status::OutOfRange();
  }

  if (payload.size() < 6 + info.uid_length) {
    return pw::Status::DataLoss();
  }

  std::memcpy(info.uid.data(), &payload[6], info.uid_length);
  info.supports_iso14443_4 = (info.sak & 0x20) != 0;

  return info;
}

//=============================================================================
// Transceive Coroutine
//=============================================================================

pw::async2::Coro<pw::Result<size_t>> Pn532NfcReader::Transceive(
    pw::async2::CoroContext& cx,
    pw::ConstByteSpan command,
    pw::ByteSpan response_buffer,
    pw::chrono::SystemClock::duration timeout) {
  auto deadline = pw::chrono::SystemClock::now() + timeout;

  // Build InDataExchange params: [Tg][DataOut...]
  if (command.size() + 1 > kMaxFrameLength) {
    co_return pw::Status::OutOfRange();
  }

  std::array<std::byte, kMaxFrameLength> params;
  params[0] = std::byte{current_target_number_};
  std::memcpy(&params[1], command.data(), command.size());
  size_t params_len = command.size() + 1;

  Pn532Command cmd{kCmdInDataExchange,
                   pw::ConstByteSpan(params.data(), params_len)};

  auto result = co_await SendCommand(cx, cmd, deadline);

  if (!result.ok()) {
    DrainReceiveBuffer();
    co_return result.status();
  }

  co_return ParseTransceiveResponse(*result, response_buffer);
}

pw::Result<size_t> Pn532NfcReader::ParseTransceiveResponse(
    pw::ConstByteSpan payload,
    pw::ByteSpan response_buffer) {
  // InDataExchange response: [Status][DataIn...]
  if (payload.empty()) {
    return pw::Status::DataLoss();
  }

  uint8_t status = static_cast<uint8_t>(payload[0]);
  if (status != 0x00) {
    PW_LOG_WARN("InDataExchange error: %02x", status);
    if (status == 0x01) {
      return pw::Status::DeadlineExceeded();
    }
    return pw::Status::Internal();
  }

  // Copy response data (excluding status byte)
  size_t data_len = payload.size() - 1;
  if (data_len > response_buffer.size()) {
    return pw::Status::ResourceExhausted();
  }

  std::memcpy(response_buffer.data(), &payload[1], data_len);
  return data_len;
}

//=============================================================================
// CheckTagPresent Coroutine
//=============================================================================

pw::async2::Coro<pw::Result<bool>> Pn532NfcReader::CheckTagPresent(
    pw::async2::CoroContext& cx,
    pw::chrono::SystemClock::duration timeout) {
  auto deadline = pw::chrono::SystemClock::now() + timeout;

  // Diagnose: NumTst=0x06 (Attention Request)
  std::array<std::byte, 1> params = {std::byte{kDiagnoseAttentionRequest}};
  Pn532Command cmd{kCmdDiagnose, params};

  auto result = co_await SendCommand(cx, cmd, deadline);

  if (!result.ok()) {
    DrainReceiveBuffer();
    co_return pw::Result<bool>(false);  // Assume tag gone on error
  }

  co_return ParseCheckPresentResponse(*result);
}

pw::Result<bool> Pn532NfcReader::ParseCheckPresentResponse(
    pw::ConstByteSpan payload) {
  // Diagnose response: [Status]
  if (payload.size() != 1) {
    return pw::Status::DataLoss();
  }

  uint8_t status = static_cast<uint8_t>(payload[0]);
  if (status == 0x00) {
    return pw::Result<bool>(true);  // Tag present
  } else if (status == 0x01) {
    return pw::Result<bool>(false);  // Tag removed
  } else {
    // Error (0x27 = not ISO14443-4 capable, etc.)
    return pw::Status::Internal();
  }
}

//=============================================================================
// Driver Methods (Init - blocking is OK here)
//=============================================================================

pw::Status Pn532NfcReader::DoInit() {
  PW_TRY(DoReset());

  // After reset, SAMConfiguration must be executed first
  // Mode=1 (normal), timeout=0x14 (1 second), IRQ=1
  std::array<std::byte, 3> sam_params = {
      std::byte{0x01}, std::byte{0x14}, std::byte{0x01}};
  std::array<std::byte, 1> response;

  auto result = SendCommandAndReceiveBlocking(kCmdSamConfiguration, sam_params,
                                              response, kDefaultTimeout);
  if (!result.ok()) {
    return result.status();
  }

  // Verify firmware version
  std::array<std::byte, 4> fw_response;
  result = SendCommandAndReceiveBlocking(kCmdGetFirmwareVersion, {}, fw_response,
                                         kDefaultTimeout);
  if (!result.ok()) {
    return result.status();
  }

  // Configure RF parameters for better reliability
  // CfgItem=0x05: MaxRtyCOM (max retries for communication)
  std::array<std::byte, 2> rf_params = {std::byte{0x05}, std::byte{0x01}};
  (void)SendCommandAndReceiveBlocking(kCmdRfConfiguration, rf_params, response,
                                      kDefaultTimeout);

  return pw::OkStatus();
}

pw::Status Pn532NfcReader::DoReset() {
  // Hardware reset: active low, hold for 20ms
  PW_TRY(reset_pin_.SetState(pw::digital_io::State::kInactive));
  pw::this_thread::sleep_for(20ms);
  PW_TRY(reset_pin_.SetState(pw::digital_io::State::kActive));
  pw::this_thread::sleep_for(10ms);

  // HSU wake up: send 0x55 dummy byte for 5th rising edge
  PW_TRY(uart_.Write(kWakeupByte));

  // T_osc_start: typically a few 100µs, up to 2ms
  pw::this_thread::sleep_for(2ms);

  return pw::OkStatus();
}

pw::Status Pn532NfcReader::DoReleaseTag(uint8_t target_number) {
  std::array<std::byte, 1> params = {std::byte{target_number}};
  std::array<std::byte, 1> response;

  auto result =
      SendCommandAndReceiveBlocking(kCmdInRelease, params, response, kDefaultTimeout);
  if (!result.ok()) {
    return result.status();
  }

  current_target_number_ = 0;
  return pw::OkStatus();
}

pw::Status Pn532NfcReader::RecoverFromDesync() {
  PW_TRY(uart_.Write(kAckFrame));
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
// Blocking Helpers (Init only)
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
  std::array<std::byte, 6> ack_buffer;
  size_t bytes_read = 0;

  auto deadline = pw::chrono::SystemClock::now() + timeout;

  while (bytes_read < ack_buffer.size()) {
    if (pw::chrono::SystemClock::now() >= deadline) {
      return pw::Status::DeadlineExceeded();
    }

    auto result = uart_.Read(
        pw::ByteSpan(ack_buffer.data() + bytes_read, ack_buffer.size() - bytes_read));
    if (result.ok() && !result.value().empty()) {
      bytes_read += result.value().size();
    } else {
      pw::this_thread::sleep_for(1ms);
    }
  }

  if (std::memcmp(ack_buffer.data(), kAckFrame.data(), kAckFrame.size()) != 0) {
    return pw::Status::DataLoss();
  }

  return pw::OkStatus();
}

pw::Result<size_t> Pn532NfcReader::ReadFrameBlocking(
    uint8_t expected_command,
    pw::ByteSpan response_buffer,
    pw::chrono::SystemClock::duration timeout) {
  std::array<std::byte, 265> rx_buffer;
  size_t bytes_read = 0;

  auto deadline = pw::chrono::SystemClock::now() + timeout;

  while (true) {
    if (pw::chrono::SystemClock::now() >= deadline) {
      return pw::Status::DeadlineExceeded();
    }

    auto result = uart_.Read(
        pw::ByteSpan(rx_buffer.data() + bytes_read, rx_buffer.size() - bytes_read));
    if (result.ok() && !result.value().empty()) {
      bytes_read += result.value().size();
    } else {
      pw::this_thread::sleep_for(1ms);
      continue;
    }

    // Need at least 5 bytes
    if (bytes_read < 5) {
      continue;
    }

    // Find start sequence
    size_t start_idx = 0;
    bool found_start = false;
    for (size_t i = 0; i + 1 < bytes_read; ++i) {
      if (rx_buffer[i] == std::byte{0x00} && rx_buffer[i + 1] == std::byte{0xFF}) {
        start_idx = i + 2;
        found_start = true;
        break;
      }
    }

    if (!found_start || start_idx + 2 > bytes_read) {
      continue;
    }

    uint8_t len = static_cast<uint8_t>(rx_buffer[start_idx]);
    uint8_t lcs = static_cast<uint8_t>(rx_buffer[start_idx + 1]);

    if (!Pn532Command::ValidateLengthChecksum(len, lcs)) {
      return pw::Status::DataLoss();
    }

    size_t expected_total = start_idx + 2 + len + 2;
    if (bytes_read < expected_total) {
      continue;
    }

    auto payload = Pn532Command::ParseResponse(
        expected_command, pw::ConstByteSpan(rx_buffer.data(), bytes_read));

    if (!payload.ok()) {
      return payload.status();
    }

    size_t copy_len = std::min(payload.value().size(), response_buffer.size());
    std::memcpy(response_buffer.data(), payload.value().data(), copy_len);
    return copy_len;
  }
}

pw::Result<size_t> Pn532NfcReader::SendCommandAndReceiveBlocking(
    uint8_t command,
    pw::ConstByteSpan params,
    pw::ByteSpan response_buffer,
    pw::chrono::SystemClock::duration timeout) {
  PW_TRY(WriteFrameBlocking(command, params));
  PW_TRY(WaitForAckBlocking(timeout));
  return ReadFrameBlocking(command, response_buffer, timeout);
}

bool Pn532NfcReader::ScanForStartSequenceBlocking(
    pw::chrono::SystemClock::duration timeout) {
  std::array<std::byte, 1> byte;
  auto deadline = pw::chrono::SystemClock::now() + timeout;
  bool found_zero = false;

  while (pw::chrono::SystemClock::now() < deadline) {
    auto result = uart_.Read(byte);
    if (!result.ok() || result.value().empty()) {
      pw::this_thread::sleep_for(1ms);
      continue;
    }

    if (found_zero && byte[0] == std::byte{0xFF}) {
      return true;
    }
    found_zero = (byte[0] == std::byte{0x00});
  }

  return false;
}

}  // namespace maco::nfc
