// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Must define PW_LOG_MODULE_NAME before including any headers that use pw_log
#define PW_LOG_MODULE_NAME "pn532"

// Uncomment below to enable debug logging for UART diagnostics
// #undef PW_LOG_LEVEL
// #define PW_LOG_LEVEL PW_LOG_LEVEL_DEBUG

#include "maco_firmware/devices/pn532/pn532_nfc_reader.h"

#include <cstring>

#include "maco_firmware/devices/pn532/pn532_command.h"
#include "maco_firmware/devices/pn532/pn532_constants.h"
#include "pw_assert/check.h"
#include "pw_async2/system_time_provider.h"
#include "pw_hex_dump/log_bytes.h"
#include "pw_log/log.h"
#include "pw_status/try.h"

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

// Default timeout for init commands (in milliseconds)
// More generous for startup commands - they only run once
constexpr uint32_t kDefaultTimeoutMs = 200;

// Convert duration to milliseconds, rounding up for sub-ms precision
inline uint32_t ToTimeoutMs(pw::chrono::SystemClock::duration timeout) {
  auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(
      timeout + std::chrono::microseconds(999));
  return static_cast<uint32_t>(ms.count());
}

Pn532NfcReader::Pn532NfcReader(pb::AsyncUart& uart,
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

InitFuture Pn532NfcReader::Start(pw::async2::Dispatcher& dispatcher) {
  PW_CHECK(!started_, "Start() called twice - only one call allowed");
  started_ = true;
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

  // Return future that will be resolved when init completes
  return init_status_provider_.Get();
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

  auto& time = pw::async2::GetSystemTimeProvider();

  // === INIT PHASE ===
  // Retry init up to 5 times - the PN532 goes back to sleep if the
  // SAMConfiguration command doesn't arrive quickly enough after wakeup,
  // which can happen due to coroutine scheduling delays.
  constexpr int kMaxInitRetries = 5;
  pw::Status init_status;
  for (int attempt = 1; attempt <= kMaxInitRetries; ++attempt) {
    init_status = co_await DoAsyncInit(cx);
    if (init_status.ok()) {
      break;
    }
    PW_LOG_WARN("PN532 init attempt %d/%d failed: %d",
                attempt, kMaxInitRetries,
                static_cast<int>(init_status.code()));
    if (attempt < kMaxInitRetries) {
      co_await time.WaitFor(100ms);
    }
  }
  init_status_provider_.Resolve(init_status);

  if (!init_status.ok()) {
    PW_LOG_ERROR("PN532 init failed after %d attempts", kMaxInitRetries);
    co_return init_status;
  }
  PW_LOG_INFO("PN532 initialized");

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
          (void)co_await DoReleaseTag(cx, current_target_number_);

          event_provider_.Resolve(
              NfcEvent{NfcEventType::kTagDeparted, current_tag_});
          current_tag_.reset();
          break;  // Back to detection loop
        }

        // Tag still present, schedule next check
        next_presence_check =
            pw::chrono::SystemClock::now() + config_.presence_check_interval;
      }

      // Short async delay to let other tasks run, then check again.
      co_await time.WaitFor(10ms);
    }
  }

  co_return pw::OkStatus();
}

//=============================================================================
// Debug Logging Helpers
//=============================================================================

namespace {

// Log a byte span with prefix using pw_hex_dump
void LogHex(const char* prefix, pw::ConstByteSpan data) {
  PW_LOG_DEBUG("%s (%u bytes):", prefix, static_cast<unsigned>(data.size()));
  pw::dump::LogBytes(PW_LOG_LEVEL_DEBUG, data);
}

}  // namespace

//=============================================================================
// SendCommand Coroutine - Core Protocol Handler
//=============================================================================

pw::async2::Coro<pw::Result<pw::ConstByteSpan>> Pn532NfcReader::SendCommand(
    [[maybe_unused]] pw::async2::CoroContext& cx,
    const Pn532Command& cmd,
    uint32_t timeout_ms) {
  // Build frame
  size_t frame_len = cmd.BuildFrame(tx_buffer_);
  if (frame_len == 0) {
    co_return pw::Status::OutOfRange();  // Command too large
  }

  // Send frame FIRST - logging can cause delays that break timing-sensitive wakeup
  auto write_result = uart_.Write(pw::ConstByteSpan(tx_buffer_.data(), frame_len));

  // Log AFTER write to avoid timing gaps
  PW_LOG_DEBUG("SendCommand 0x%02X, timeout=%ums", cmd.command, static_cast<unsigned>(timeout_ms));
  LogHex("TX", pw::ConstByteSpan(tx_buffer_.data(), frame_len));
  if (!write_result.ok()) {
    PW_LOG_DEBUG("TX write failed: %d", static_cast<int>(write_result.code()));
    co_return write_result;
  }

  // Wait for ACK (exactly 6 bytes)
  PW_LOG_DEBUG("Waiting for ACK...");
  auto ack_future = uart_.ReadWithTimeout(ack_buffer_, 6, timeout_ms);
  auto ack_result = co_await ack_future;
  if (!ack_result.ok()) {
    PW_LOG_DEBUG("ACK read failed: %d", static_cast<int>(ack_result.status().code()));
    co_return ack_result.status();
  }
  LogHex("ACK RX", pw::ConstByteSpan(ack_buffer_.data(), ack_result.size()));

  // Validate ACK
  if (std::memcmp(ack_buffer_.data(), kAckFrame.data(), kAckFrame.size()) != 0) {
    PW_LOG_ERROR("Invalid ACK for cmd 0x%02x", cmd.command);
    co_return pw::Status::DataLoss();
  }

  // Read response frame - first read header to get length
  // Need at least 5 bytes: preamble(1) + start(2) + len(1) + lcs(1)
  PW_LOG_DEBUG("Waiting for response header...");
  auto hdr_future = uart_.ReadWithTimeout(rx_buffer_, 5, timeout_ms);
  auto hdr_result = co_await hdr_future;
  if (!hdr_result.ok()) {
    PW_LOG_DEBUG("Response header read failed: %d", static_cast<int>(hdr_result.status().code()));
    co_return hdr_result.status();
  }
  size_t rx_received = hdr_result.size();
  LogHex("RX hdr", pw::ConstByteSpan(rx_buffer_.data(), rx_received));

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
    PW_LOG_ERROR("Start sequence not found for cmd 0x%02x", cmd.command);
    co_return pw::Status::DataLoss();
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

  // Read remainder if needed
  if (rx_received < expected_total) {
    size_t remaining = expected_total - rx_received;
    PW_LOG_DEBUG("Reading %u more bytes for response...", static_cast<unsigned>(remaining));
    auto rest_future = uart_.ReadWithTimeout(
        pw::ByteSpan(rx_buffer_.data() + rx_received, remaining),
        remaining,
        timeout_ms);
    auto rest_result = co_await rest_future;
    if (!rest_result.ok()) {
      PW_LOG_DEBUG("Response remainder read failed: %d",
                   static_cast<int>(rest_result.status().code()));
      co_return rest_result.status();
    }
    rx_received += rest_result.size();
  }

  LogHex("RX full", pw::ConstByteSpan(rx_buffer_.data(), rx_received));

  // Parse response
  auto payload = Pn532Command::ParseResponse(
      cmd.command, pw::ConstByteSpan(rx_buffer_.data(), rx_received));

  if (!payload.ok()) {
    PW_LOG_ERROR("Parse error for cmd 0x%02x: %d", cmd.command,
                 static_cast<int>(payload.status().code()));
  } else {
    PW_LOG_DEBUG("Command 0x%02X success, payload %u bytes",
                 cmd.command, static_cast<unsigned>(payload->size()));
  }

  co_return payload;
}

//=============================================================================
// DetectTag Coroutine
//=============================================================================

pw::async2::Coro<pw::Result<TagInfo>> Pn532NfcReader::DetectTag(
    pw::async2::CoroContext& cx,
    pw::chrono::SystemClock::duration timeout) {
  uint32_t timeout_ms = ToTimeoutMs(timeout);

  // InListPassiveTarget: MaxTg=1, BrTy=106kbps Type A
  std::array<std::byte, 2> params = {std::byte{0x01}, std::byte{0x00}};
  Pn532Command cmd{kCmdInListPassiveTarget, params};

  auto result = co_await SendCommand(cx, cmd, timeout_ms);

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
  uint32_t timeout_ms = ToTimeoutMs(timeout);

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

  auto result = co_await SendCommand(cx, cmd, timeout_ms);

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
  uint32_t timeout_ms = ToTimeoutMs(timeout);

  // Diagnose: NumTst=0x06 (Attention Request)
  std::array<std::byte, 1> params = {std::byte{kDiagnoseAttentionRequest}};
  Pn532Command cmd{kCmdDiagnose, params};

  auto result = co_await SendCommand(cx, cmd, timeout_ms);

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
// Async Init Coroutine
//=============================================================================

pw::async2::Coro<pw::Status> Pn532NfcReader::DoAsyncInit(
    pw::async2::CoroContext& cx) {
  auto& time = pw::async2::GetSystemTimeProvider();

  PW_LOG_DEBUG("Init: starting hardware reset");

  // Hardware reset: active low, hold for 20ms
  auto status = reset_pin_.SetState(pw::digital_io::State::kInactive);
  if (!status.ok()) {
    PW_LOG_ERROR("Init: reset low failed: %d", static_cast<int>(status.code()));
    co_return status;
  }
  co_await time.WaitFor(20ms);

  status = reset_pin_.SetState(pw::digital_io::State::kActive);
  if (!status.ok()) {
    PW_LOG_ERROR("Init: reset high failed: %d", static_cast<int>(status.code()));
    co_return status;
  }
  PW_LOG_DEBUG("Init: reset complete, waiting 10ms");

  // Wait for PN532 internal initialization after reset
  co_await time.WaitFor(10ms);

  // Drain any garbage BEFORE wakeup
  DrainReceiveBuffer();

  // HSU wakeup with extended preamble.
  // At 115200 baud: ~11.5 bytes/ms, so 24 bytes = ~2ms preamble.
  // This covers T_osc_start while the oscillator stabilizes.
  // uart_.Write() is non-blocking (buffers data), so the preamble and
  // command frame are sent back-to-back with no gaps.
  constexpr std::array<std::byte, 24> kWakeupPreamble = {
      std::byte{0x55}, std::byte{0x55}, std::byte{0x55}, std::byte{0x55},
      std::byte{0x55}, std::byte{0x55}, std::byte{0x55}, std::byte{0x55},
      std::byte{0x55}, std::byte{0x55}, std::byte{0x55}, std::byte{0x55},
      std::byte{0x55}, std::byte{0x55}, std::byte{0x55}, std::byte{0x55},
      std::byte{0x55}, std::byte{0x55}, std::byte{0x55}, std::byte{0x55},
      std::byte{0x55}, std::byte{0x55}, std::byte{0x55}, std::byte{0x55}};
  status = uart_.Write(kWakeupPreamble);
  if (!status.ok()) {
    PW_LOG_ERROR("Init: wakeup write failed: %d", static_cast<int>(status.code()));
    co_return status;
  }

  // SAMConfiguration - sent immediately after preamble (no delay needed!)
  // Mode=1 (normal), timeout=0x14 (1 second), IRQ=1
  std::array<std::byte, 3> sam_params = {
      std::byte{0x01}, std::byte{0x14}, std::byte{0x01}};
  Pn532Command sam_cmd{kCmdSamConfiguration, sam_params};

  auto result = co_await SendCommand(cx, sam_cmd, kDefaultTimeoutMs);
  if (!result.ok()) {
    PW_LOG_ERROR("SAMConfiguration failed: %d", static_cast<int>(result.status().code()));
    co_return result.status();
  }
  PW_LOG_DEBUG("Init: SAMConfiguration OK");

  // GetFirmwareVersion
  PW_LOG_DEBUG("Init: sending GetFirmwareVersion");
  Pn532Command fw_cmd{kCmdGetFirmwareVersion, {}};
  result = co_await SendCommand(cx, fw_cmd, kDefaultTimeoutMs);
  if (!result.ok()) {
    PW_LOG_ERROR("GetFirmwareVersion failed: %d", static_cast<int>(result.status().code()));
    co_return result.status();
  }
  // Log firmware version from payload: [IC][Ver][Rev][Support]
  if (result->size() >= 4) {
    auto fw = *result;
    PW_LOG_INFO("PN532 firmware: IC=0x%02X Ver=%d.%d Support=0x%02X",
                static_cast<uint8_t>(fw[0]), static_cast<uint8_t>(fw[1]),
                static_cast<uint8_t>(fw[2]), static_cast<uint8_t>(fw[3]));
  }

  // Configure RF parameters for better reliability
  // CfgItem=0x05: MaxRetries (MxRtyATR, MxRtyPSL, MxRtyPassiveActivation)
  PW_LOG_DEBUG("Init: sending RFConfiguration");
  std::array<std::byte, 4> rf_params = {
      std::byte{0x05},  // CfgItem: MaxRetries
      std::byte{0xFF},  // MxRtyATR: max retries for ATR_REQ
      std::byte{0x01},  // MxRtyPSL: max retries for PSL_REQ
      std::byte{0x02}}; // MxRtyPassiveActivation: max retries for InListPassiveTarget
  Pn532Command rf_cmd{kCmdRfConfiguration, rf_params};
  (void)co_await SendCommand(cx, rf_cmd, kDefaultTimeoutMs);

  PW_LOG_DEBUG("Init: complete");
  co_return pw::OkStatus();
}

pw::async2::Coro<pw::Status> Pn532NfcReader::DoReleaseTag(
    pw::async2::CoroContext& cx, uint8_t target_number) {
  // InRelease command - properly wait for response to avoid pending data
  std::array<std::byte, 1> params = {std::byte{target_number}};
  Pn532Command cmd{kCmdInRelease, params};

  auto result = co_await SendCommand(cx, cmd, kDefaultTimeoutMs);
  current_target_number_ = 0;

  if (!result.ok()) {
    // Drain any partial response
    DrainReceiveBuffer();
    co_return result.status();
  }

  co_return pw::OkStatus();
}

pw::async2::Coro<pw::Status> Pn532NfcReader::RecoverFromDesync(
    [[maybe_unused]] pw::async2::CoroContext& cx) {
  auto& time = pw::async2::GetSystemTimeProvider();

  // Send ACK to abort any pending command
  (void)uart_.Write(kAckFrame);

  // Wait for any in-flight response to complete.
  // Worst case: 265-byte frame at 115200 baud = ~23ms
  co_await time.WaitFor(25ms);

  DrainReceiveBuffer();
  co_return pw::OkStatus();
}

void Pn532NfcReader::DrainReceiveBuffer() {
  uart_.Drain();
}

}  // namespace maco::nfc
