// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <array>
#include <cstddef>
#include <cstdint>

#include "pw_bytes/span.h"

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

}  // namespace maco::nfc
