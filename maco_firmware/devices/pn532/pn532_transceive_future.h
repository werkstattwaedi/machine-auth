// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <array>
#include <cstddef>
#include <cstdint>

#include "maco_firmware/devices/pn532/pn532_call_future.h"
#include "maco_firmware/devices/pn532/pn532_constants.h"
#include "pw_async2/future.h"
#include "pw_bytes/span.h"
#include "pw_chrono/system_clock.h"
#include "pw_result/result.h"
#include "pw_stream/stream.h"

namespace maco::nfc {

class Pn532NfcReader;  // Forward declaration

/// Future for InDataExchange (APDU transceive).
///
/// Uses Pn532CallFuture for the protocol state machine, then parses
/// the InDataExchange response to extract the APDU response data.
class Pn532TransceiveFuture
    : public pw::async2::ListableFutureWithWaker<Pn532TransceiveFuture,
                                                  pw::Result<size_t>> {
 public:
  using Base =
      pw::async2::ListableFutureWithWaker<Pn532TransceiveFuture,
                                           pw::Result<size_t>>;
  static constexpr const char kWaitReason[] = "Pn532Transceive";

  // Move constructor
  Pn532TransceiveFuture(Pn532TransceiveFuture&& other) noexcept;
  Pn532TransceiveFuture& operator=(Pn532TransceiveFuture&& other) noexcept;

  // Not copyable
  Pn532TransceiveFuture(const Pn532TransceiveFuture&) = delete;
  Pn532TransceiveFuture& operator=(const Pn532TransceiveFuture&) = delete;

 private:
  friend class Pn532NfcReader;
  friend Base;

  Pn532TransceiveFuture(
      pw::async2::SingleFutureProvider<Pn532TransceiveFuture>& provider,
      Pn532NfcReader& reader,
      pw::ConstByteSpan command,
      pw::ByteSpan response_buffer,
      pw::chrono::SystemClock::time_point deadline);

  pw::async2::Poll<pw::Result<size_t>> DoPend(pw::async2::Context& cx);

  /// Parse InDataExchange response and copy data to response_buffer_.
  pw::Result<size_t> ParseResponse(pw::ConstByteSpan payload);

  Pn532NfcReader* reader_;
  pw::ByteSpan response_buffer_;  // Caller's buffer for APDU response

  // Command params buffer: [Tg][DataOut...] - must be before call_future_
  std::array<std::byte, pn532::kMaxFrameLength> params_;
  size_t params_len_ = 0;

  Pn532CallFuture call_future_;
};

}  // namespace maco::nfc
