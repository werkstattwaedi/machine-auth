// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <array>
#include <cstddef>
#include <cstdint>

#include "maco_firmware/devices/pn532/pn532_call_future.h"
#include "pw_async2/future.h"
#include "pw_bytes/span.h"
#include "pw_chrono/system_clock.h"
#include "pw_result/result.h"
#include "pw_stream/stream.h"

namespace maco::nfc {

class Pn532NfcReader;  // Forward declaration

/// Future for Diagnose presence check (NumTst=0x06 Attention Request).
///
/// Uses Pn532CallFuture for the protocol state machine, then parses
/// the Diagnose response to determine if tag is still present.
class Pn532CheckPresentFuture
    : public pw::async2::ListableFutureWithWaker<Pn532CheckPresentFuture,
                                                  pw::Result<bool>> {
 public:
  using Base =
      pw::async2::ListableFutureWithWaker<Pn532CheckPresentFuture,
                                           pw::Result<bool>>;
  static constexpr const char kWaitReason[] = "Pn532CheckPresent";

  // Move constructor
  Pn532CheckPresentFuture(Pn532CheckPresentFuture&& other) noexcept;
  Pn532CheckPresentFuture& operator=(Pn532CheckPresentFuture&& other) noexcept;

  // Not copyable
  Pn532CheckPresentFuture(const Pn532CheckPresentFuture&) = delete;
  Pn532CheckPresentFuture& operator=(const Pn532CheckPresentFuture&) = delete;

 private:
  friend class Pn532NfcReader;
  friend Base;

  Pn532CheckPresentFuture(
      pw::async2::SingleFutureProvider<Pn532CheckPresentFuture>& provider,
      Pn532NfcReader& reader,
      pw::chrono::SystemClock::time_point deadline);

  pw::async2::Poll<pw::Result<bool>> DoPend(pw::async2::Context& cx);

  /// Parse Diagnose response to determine presence.
  pw::Result<bool> ParseResponse(pw::ConstByteSpan payload);

  Pn532NfcReader* reader_;

  // Command params buffer (NumTst=0x06) - must be before call_future_
  std::array<std::byte, 1> params_;

  Pn532CallFuture call_future_;
};

}  // namespace maco::nfc
