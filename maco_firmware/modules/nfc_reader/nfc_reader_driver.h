// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <array>
#include <cstddef>
#include <cstdint>

#include "pw_bytes/span.h"
#include "pw_chrono/system_clock.h"
#include "pw_result/result.h"
#include "pw_status/status.h"

namespace maco::nfc {

/// Information about a detected NFC tag.
struct TagInfo {
  std::array<std::byte, 10> uid;
  size_t uid_length;
  uint8_t sak;  // SAK byte indicates tag capabilities
  uint8_t target_number;  // Tg from InListPassiveTarget (for InDataExchange)
  bool supports_iso14443_4;  // Derived from SAK bit 5 ((sak & 0x20) != 0)

  pw::ConstByteSpan GetUid() const {
    return pw::ConstByteSpan(uid.data(), uid_length);
  }
};

/// Abstract hardware interface for NFC reader ICs.
///
/// Uses CRTP (Curiously Recurring Template Pattern) to avoid virtual functions
/// with concrete Future return types. Each driver implementation defines its
/// own Future types.
///
/// Key constraint: Only one NFC operation can be in flight at a time (hardware
/// limitation). Implementations should use SingleFutureProvider to enforce
/// this.
template <typename Derived>
class NfcReaderDriverBase {
 public:
  /// Initialize the driver (reset, configure SAM, etc.)
  pw::Status Init() { return derived().DoInit(); }

  /// Hardware reset the reader.
  pw::Status Reset() { return derived().DoReset(); }

  /// Start tag detection (async).
  /// @param timeout Maximum time to wait for a tag
  /// @return Driver-specific future that resolves to TagInfo or error
  auto DetectTag(pw::chrono::SystemClock::duration timeout) {
    return derived().DoDetectTag(timeout);
  }

  /// Exchange APDU with detected tag (async).
  /// @param command APDU command bytes
  /// @param response_buffer Buffer for response
  /// @param timeout Maximum time for exchange
  /// @return Driver-specific future that resolves to response length or error
  auto Transceive(pw::ConstByteSpan command,
                  pw::ByteSpan response_buffer,
                  pw::chrono::SystemClock::duration timeout) {
    return derived().DoTransceive(command, response_buffer, timeout);
  }

  /// Check if tag is still present in the field (async).
  /// @param timeout Maximum time for check
  /// @return Driver-specific future that resolves to bool or error
  auto CheckTagPresent(pw::chrono::SystemClock::duration timeout) {
    return derived().DoCheckTagPresent(timeout);
  }

  /// Release the current tag (cleanup reader state).
  /// @param target_number The Tg from TagInfo
  pw::Status ReleaseTag(uint8_t target_number) {
    return derived().DoReleaseTag(target_number);
  }

 private:
  Derived& derived() { return static_cast<Derived&>(*this); }
  const Derived& derived() const { return static_cast<const Derived&>(*this); }
};

}  // namespace maco::nfc
