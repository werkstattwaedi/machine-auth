// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

// Internal header - not for public use.
// Contains PN532 protocol constants shared between driver and futures.

#include <cstddef>
#include <cstdint>

#include "pw_bytes/array.h"

namespace maco::nfc::pn532 {

// Maximum frame payload length
inline constexpr size_t kMaxFrameLength = 255;

// Protocol constants
inline constexpr auto kPreamble = pw::bytes::Array<0x00>();
inline constexpr auto kStartCode = pw::bytes::Array<0x00, 0xFF>();
inline constexpr auto kPostamble = pw::bytes::Array<0x00>();
inline constexpr auto kAckFrame =
    pw::bytes::Array<0x00, 0x00, 0xFF, 0x00, 0xFF, 0x00>();
inline constexpr auto kNackFrame =
    pw::bytes::Array<0x00, 0x00, 0xFF, 0xFF, 0x00, 0x00>();
inline constexpr auto kWakeupByte = pw::bytes::Array<0x55>();

// TFI (Frame Identifier) values
inline constexpr std::byte kTfiHostToPn532{0xD4};
inline constexpr std::byte kTfiPn532ToHost{0xD5};
inline constexpr std::byte kTfiError{0x7F};

// PN532 Commands
inline constexpr uint8_t kCmdDiagnose = 0x00;
inline constexpr uint8_t kCmdGetFirmwareVersion = 0x02;
inline constexpr uint8_t kCmdSamConfiguration = 0x14;
inline constexpr uint8_t kCmdRfConfiguration = 0x32;
inline constexpr uint8_t kCmdInListPassiveTarget = 0x4A;
inline constexpr uint8_t kCmdInDataExchange = 0x40;
inline constexpr uint8_t kCmdInRelease = 0x52;

// Diagnose test numbers
inline constexpr uint8_t kDiagnoseAttentionRequest = 0x06;

}  // namespace maco::nfc::pn532
