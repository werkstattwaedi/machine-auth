// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <array>
#include <cstddef>
#include <cstdint>

#include "maco_firmware/devices/pn532/pn532_command.h"
#include "pw_async2/context.h"
#include "pw_async2/poll.h"
#include "pw_bytes/span.h"
#include "pw_chrono/system_clock.h"
#include "pw_result/result.h"
#include "pw_stream/stream.h"

namespace maco::nfc {

/// Reusable future for PN532 command/response cycles.
///
/// Handles the common state machine:
///   build frame → send → wait ACK → receive response → verify
///
/// Does NOT parse the response payload - caller interprets the payload bytes.
///
/// Usage:
/// @code
/// Pn532CallFuture call_future(
///     uart,
///     Pn532Command{kCmdInListPassiveTarget, params},
///     deadline);
///
/// while (true) {
///   auto poll = call_future.Poll(cx);
///   if (poll.IsPending()) continue;
///   if (!poll.value().ok()) { /* handle error */ }
///   auto payload = poll.value().value();  // Interpret response
/// }
/// @endcode
class Pn532CallFuture {
 public:
  /// Construct a call future for a PN532 command.
  /// @param uart UART stream for communication
  /// @param command Command to send (frame is built in constructor)
  /// @param deadline Timeout for the entire operation
  Pn532CallFuture(pw::stream::ReaderWriter& uart,
                  const Pn532Command& command,
                  pw::chrono::SystemClock::time_point deadline);

  // Move-only
  Pn532CallFuture(Pn532CallFuture&& other) noexcept;
  Pn532CallFuture& operator=(Pn532CallFuture&& other) noexcept;

  Pn532CallFuture(const Pn532CallFuture&) = delete;
  Pn532CallFuture& operator=(const Pn532CallFuture&) = delete;

  /// Poll the state machine.
  /// @return Poll with:
  ///   - Pending() if still waiting for data
  ///   - Ready(DeadlineExceeded) if timeout
  ///   - Ready(DataLoss) if protocol error (checksum, CMD mismatch)
  ///   - Ready(Internal) if PN532 returned error frame
  ///   - Ready(payload_span) if complete
  pw::async2::Poll<pw::Result<pw::ConstByteSpan>> Poll(
      pw::async2::Context& cx);

 private:
  pw::stream::ReaderWriter* uart_;
  pw::chrono::SystemClock::time_point deadline_;

  enum class State { kSending, kWaitingAck, kWaitingResponse };
  State state_ = State::kSending;

  uint8_t command_;  // Stored to verify response CMD == command_ + 1
  size_t frame_len_ = 0;
  size_t bytes_sent_ = 0;
  size_t bytes_received_ = 0;

  std::array<std::byte, 6> ack_buffer_;
  std::array<std::byte, 265> tx_buffer_;
  std::array<std::byte, 265> response_buffer_;
};

}  // namespace maco::nfc
