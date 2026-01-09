// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <array>
#include <cstddef>
#include <cstdint>

#include "maco_firmware/devices/pn532/pn532_call_future.h"
#include "maco_firmware/devices/pn532/tag_info.h"
#include "pw_async2/future.h"
#include "pw_bytes/span.h"
#include "pw_chrono/system_clock.h"
#include "pw_result/result.h"
#include "pw_stream/stream.h"

namespace maco::nfc {

class Pn532NfcReader;  // Forward declaration

/// Future for InListPassiveTarget (tag detection).
///
/// Uses Pn532CallFuture for the protocol state machine, then parses
/// the InListPassiveTarget response to extract TagInfo.
///
/// Returns NotFound if timeout occurs while waiting for response (no card).
class Pn532DetectTagFuture
    : public pw::async2::ListableFutureWithWaker<Pn532DetectTagFuture,
                                                  pw::Result<TagInfo>> {
 public:
  using Base =
      pw::async2::ListableFutureWithWaker<Pn532DetectTagFuture,
                                           pw::Result<TagInfo>>;
  static constexpr const char kWaitReason[] = "Pn532DetectTag";

  // Move constructor
  Pn532DetectTagFuture(Pn532DetectTagFuture&& other) noexcept;
  Pn532DetectTagFuture& operator=(Pn532DetectTagFuture&& other) noexcept;

  // Not copyable
  Pn532DetectTagFuture(const Pn532DetectTagFuture&) = delete;
  Pn532DetectTagFuture& operator=(const Pn532DetectTagFuture&) = delete;

 private:
  friend class Pn532NfcReader;
  friend Base;

  Pn532DetectTagFuture(
      pw::async2::SingleFutureProvider<Pn532DetectTagFuture>& provider,
      Pn532NfcReader& reader,
      pw::chrono::SystemClock::time_point deadline);

  pw::async2::Poll<pw::Result<TagInfo>> DoPend(pw::async2::Context& cx);

  /// Parse InListPassiveTarget response payload.
  pw::Result<TagInfo> ParseResponse(pw::ConstByteSpan payload);

  Pn532NfcReader* reader_;

  // Command params buffer - must be before call_future_
  std::array<std::byte, 2> params_;

  Pn532CallFuture call_future_;
};

}  // namespace maco::nfc
