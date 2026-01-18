// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/devices/pn532/pn532_call_future.h"

#include <cstring>

#include "maco_firmware/devices/pn532/pn532_constants.h"

#define PW_LOG_MODULE_NAME "pn532"

#include "pw_log/log.h"

namespace maco::nfc {

using namespace pn532;

Pn532CallFuture::Pn532CallFuture(
    pw::stream::ReaderWriter& uart,
    const Pn532Command& command,
    pw::chrono::SystemClock::time_point deadline)
    : uart_(&uart), deadline_(deadline), command_(command.command) {
  frame_len_ = command.BuildFrame(tx_buffer_);
}

Pn532CallFuture::Pn532CallFuture(Pn532CallFuture&& other) noexcept
    : uart_(other.uart_),
      deadline_(other.deadline_),
      state_(other.state_),
      command_(other.command_),
      frame_len_(other.frame_len_),
      bytes_sent_(other.bytes_sent_),
      bytes_received_(other.bytes_received_),
      ack_buffer_(other.ack_buffer_),
      tx_buffer_(other.tx_buffer_),
      response_buffer_(other.response_buffer_) {
  other.uart_ = nullptr;
}

Pn532CallFuture& Pn532CallFuture::operator=(Pn532CallFuture&& other) noexcept {
  uart_ = other.uart_;
  deadline_ = other.deadline_;
  state_ = other.state_;
  command_ = other.command_;
  frame_len_ = other.frame_len_;
  bytes_sent_ = other.bytes_sent_;
  bytes_received_ = other.bytes_received_;
  ack_buffer_ = other.ack_buffer_;
  tx_buffer_ = other.tx_buffer_;
  response_buffer_ = other.response_buffer_;
  other.uart_ = nullptr;
  return *this;
}

pw::async2::Poll<pw::Result<pw::ConstByteSpan>> Pn532CallFuture::Poll(
    [[maybe_unused]] pw::async2::Context& cx) {
  using pw::async2::Pending;
  using pw::async2::Ready;

  if (uart_ == nullptr) {
    return Ready(pw::Status::FailedPrecondition());
  }

  if (frame_len_ == 0) {
    return Ready(pw::Status::OutOfRange());  // Command too large
  }

  // Check timeout
  if (pw::chrono::SystemClock::now() >= deadline_) {
    return Ready(pw::Status::DeadlineExceeded());
  }

  switch (state_) {
    case State::kSending: {
      auto remaining = pw::ConstByteSpan(tx_buffer_.data() + bytes_sent_,
                                         frame_len_ - bytes_sent_);
      auto result = uart_->Write(remaining);
      if (!result.ok()) {
        return Ready(result);
      }

      bytes_sent_ = frame_len_;  // Write is all-or-nothing
      state_ = State::kWaitingAck;
      bytes_received_ = 0;
      [[fallthrough]];
    }

    case State::kWaitingAck: {
      auto result = uart_->Read(pw::ByteSpan(
          ack_buffer_.data() + bytes_received_,
          ack_buffer_.size() - bytes_received_));

      if (result.ok() && !result.value().empty()) {
        bytes_received_ += result.value().size();
        PW_LOG_DEBUG("ACK: received %u bytes, total %u/%u",
                     static_cast<unsigned>(result.value().size()),
                     static_cast<unsigned>(bytes_received_),
                     static_cast<unsigned>(ack_buffer_.size()));
      }

      if (bytes_received_ < ack_buffer_.size()) {
        return Pending();
      }

      // Validate ACK
      if (std::memcmp(ack_buffer_.data(), kAckFrame.data(),
                      kAckFrame.size()) != 0) {
        PW_LOG_ERROR("Invalid ACK for cmd 0x%02x", command_);
        return Ready(pw::Status::DataLoss());
      }

      state_ = State::kWaitingResponse;
      bytes_received_ = 0;
      [[fallthrough]];
    }

    case State::kWaitingResponse: {
      auto result = uart_->Read(pw::ByteSpan(
          response_buffer_.data() + bytes_received_,
          response_buffer_.size() - bytes_received_));

      if (result.ok() && !result.value().empty()) {
        bytes_received_ += result.value().size();
        PW_LOG_INFO("RESP: received %u bytes, total %u",
                    static_cast<unsigned>(result.value().size()),
                    static_cast<unsigned>(bytes_received_));
      }

      // Need at least 5 bytes to determine frame length
      // Minimum: preamble + start(2) + len + lcs = can start at offset 0-N
      if (bytes_received_ < 5) {
        return Pending();
      }

      // Find start sequence (0x00 0xFF)
      size_t start_idx = 0;
      bool found_start = false;
      for (size_t i = 0; i + 1 < bytes_received_; ++i) {
        if (response_buffer_[i] == std::byte{0x00} &&
            response_buffer_[i + 1] == std::byte{0xFF}) {
          start_idx = i + 2;  // Point to LEN
          found_start = true;
          break;
        }
      }

      if (!found_start || start_idx + 2 > bytes_received_) {
        return Pending();
      }

      // Parse length
      uint8_t len = static_cast<uint8_t>(response_buffer_[start_idx]);
      uint8_t lcs = static_cast<uint8_t>(response_buffer_[start_idx + 1]);

      if (!Pn532Command::ValidateLengthChecksum(len, lcs)) {
        PW_LOG_ERROR("Invalid LCS for cmd 0x%02x", command_);
        return Ready(pw::Status::DataLoss());
      }

      // Full frame: start_idx + 2 (len/lcs) + len (data) + 1 (dcs) + 1 (postamble)
      size_t expected_total = start_idx + 2 + len + 2;
      if (bytes_received_ < expected_total) {
        return Pending();
      }

      // Parse response using Pn532Command helper
      auto payload = Pn532Command::ParseResponse(
          command_,
          pw::ConstByteSpan(response_buffer_.data(), bytes_received_));

      if (!payload.ok()) {
        PW_LOG_ERROR("Parse error for cmd 0x%02x: %d",
                     command_, static_cast<int>(payload.status().code()));
      }

      return Ready(payload);
    }
  }

  return Ready(pw::Status::Internal());  // Unreachable
}

}  // namespace maco::nfc
