// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/devices/pn532/pn532_driver.h"

#include <cstring>

#include "maco_firmware/devices/pn532/pn532_command.h"
#include "maco_firmware/devices/pn532/pn532_constants.h"
#include "pw_assert/check.h"
#include "pw_log/log.h"
#include "pw_thread/sleep.h"

namespace maco::nfc {

using namespace std::chrono_literals;
using namespace pn532;

Pn532Driver::Pn532Driver(pw::stream::ReaderWriter& uart,
                         pw::digital_io::DigitalOut& reset_pin)
    : uart_(uart), reset_pin_(reset_pin) {}

pw::Status Pn532Driver::DoInit() {
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

pw::Status Pn532Driver::DoReset() {
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

bool Pn532Driver::IsBusy() const {
  // Check if any provider has a pending future
  // Note: const_cast needed because has_future() is not const in Pigweed
  auto& self = const_cast<Pn532Driver&>(*this);
  return self.detect_provider_.has_future() ||
         self.transceive_provider_.has_future() ||
         self.check_present_provider_.has_future();
}

Pn532AwaitIdleFuture Pn532Driver::AwaitIdle() {
  return Pn532AwaitIdleFuture(*this);
}

// -- Async Entry Points --

Pn532DetectTagFuture Pn532Driver::DoDetectTag(
    pw::chrono::SystemClock::duration timeout) {
  PW_CHECK(!IsBusy(),
           "PN532 can only process one command at a time. "
           "Use AwaitIdle() to wait for the current operation to complete.");
  auto deadline = pw::chrono::SystemClock::now() + timeout;
  return Pn532DetectTagFuture(detect_provider_, *this, deadline);
}

Pn532TransceiveFuture Pn532Driver::DoTransceive(
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

Pn532CheckPresentFuture Pn532Driver::DoCheckTagPresent(
    pw::chrono::SystemClock::duration timeout) {
  PW_CHECK(!IsBusy(),
           "PN532 can only process one command at a time. "
           "Use AwaitIdle() to wait for the current operation to complete.");
  auto deadline = pw::chrono::SystemClock::now() + timeout;
  return Pn532CheckPresentFuture(check_present_provider_, *this, deadline);
}

// -- Sync Operations (non-I/O) --

pw::Status Pn532Driver::DoReleaseTag(uint8_t target_number) {
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

pw::Status Pn532Driver::RecoverFromDesync() {
  // Send ACK to abort any pending command
  PW_TRY(uart_.Write(kAckFrame));

  // Drain UART buffer
  DrainReceiveBuffer();

  return pw::OkStatus();
}

void Pn532Driver::DrainReceiveBuffer() {
  std::array<std::byte, 64> discard;
  while (true) {
    auto result = uart_.Read(discard);
    if (!result.ok() || result.value().empty()) {
      break;
    }
  }
}

// -- Init-Only Blocking Helpers --

pw::Status Pn532Driver::WriteFrameBlocking(uint8_t command,
                                           pw::ConstByteSpan params) {
  std::array<std::byte, 265> tx_buffer;
  Pn532Command cmd{command, params};
  size_t frame_len = cmd.BuildFrame(tx_buffer);
  if (frame_len == 0) {
    return pw::Status::OutOfRange();
  }
  return uart_.Write(pw::ConstByteSpan(tx_buffer.data(), frame_len));
}

pw::Status Pn532Driver::WaitForAckBlocking(
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

pw::Result<size_t> Pn532Driver::ReadFrameBlocking(
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

pw::Result<size_t> Pn532Driver::SendCommandAndReceiveBlocking(
    uint8_t command,
    pw::ConstByteSpan params,
    pw::ByteSpan response_buffer,
    pw::chrono::SystemClock::duration timeout) {
  PW_TRY(WriteFrameBlocking(command, params));
  PW_TRY(WaitForAckBlocking(kDefaultTimeout));
  return ReadFrameBlocking(command, response_buffer, timeout);
}

bool Pn532Driver::ScanForStartSequenceBlocking(
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
