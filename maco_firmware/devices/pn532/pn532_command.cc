// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/devices/pn532/pn532_command.h"

#include "maco_firmware/devices/pn532/pn532_constants.h"

namespace maco::nfc {

using namespace pn532;

size_t Pn532Command::BuildFrame(pw::ByteSpan buffer) const {
  // Frame format:
  // [PREAMBLE] [START_CODE] [LEN] [LCS] [TFI] [CMD] [PARAMS...] [DCS] [POSTAMBLE]
  //    1          2          1     1     1     1      N          1       1
  // Total: 9 + params.size()

  size_t data_len = 2 + params.size();  // TFI + CMD + params
  if (data_len > kMaxFrameLength) {
    return 0;  // Params too large
  }

  size_t total_len = 9 + params.size();
  if (buffer.size() < total_len) {
    return 0;  // Buffer too small
  }

  size_t idx = 0;

  // Preamble and start code
  buffer[idx++] = std::byte{0x00};  // Preamble
  buffer[idx++] = std::byte{0x00};  // Start code byte 1
  buffer[idx++] = std::byte{0xFF};  // Start code byte 2

  // LEN and LCS
  uint8_t len = static_cast<uint8_t>(data_len);
  buffer[idx++] = std::byte{len};
  buffer[idx++] = std::byte{CalculateLengthChecksum(len)};

  // TFI and command
  buffer[idx++] = kTfiHostToPn532;
  buffer[idx++] = std::byte{command};

  // Parameters
  for (auto b : params) {
    buffer[idx++] = b;
  }

  // Calculate DCS over TFI + CMD + params
  uint8_t checksum = static_cast<uint8_t>(kTfiHostToPn532) + command;
  for (auto b : params) {
    checksum += static_cast<uint8_t>(b);
  }
  buffer[idx++] = std::byte{static_cast<uint8_t>(~checksum + 1)};

  // Postamble
  buffer[idx++] = std::byte{0x00};

  return idx;
}

pw::Result<pw::ConstByteSpan> Pn532Command::ParseResponse(
    uint8_t expected_command,
    pw::ConstByteSpan frame) {
  // Find start sequence (0x00 0xFF)
  size_t start_idx = 0;
  bool found_start = false;
  for (size_t i = 0; i + 1 < frame.size(); ++i) {
    if (frame[i] == std::byte{0x00} && frame[i + 1] == std::byte{0xFF}) {
      start_idx = i + 2;  // Point to LEN
      found_start = true;
      break;
    }
  }

  if (!found_start) {
    return pw::Status::DataLoss();
  }

  // Need at least LEN + LCS
  if (start_idx + 2 > frame.size()) {
    return pw::Status::DataLoss();
  }

  // Parse and validate length
  uint8_t len = static_cast<uint8_t>(frame[start_idx]);
  uint8_t lcs = static_cast<uint8_t>(frame[start_idx + 1]);

  if (!ValidateLengthChecksum(len, lcs)) {
    return pw::Status::DataLoss();
  }

  // Check we have complete frame: LEN/LCS + data + DCS + postamble
  size_t data_start = start_idx + 2;
  if (data_start + len + 2 > frame.size()) {
    return pw::Status::DataLoss();
  }

  // Validate TFI
  std::byte tfi = frame[data_start];
  if (tfi == kTfiError) {
    return pw::Status::Internal();
  }
  if (tfi != kTfiPn532ToHost) {
    return pw::Status::DataLoss();
  }

  // Validate response command (should be expected_command + 1)
  if (len < 2) {
    return pw::Status::DataLoss();
  }
  uint8_t response_cmd = static_cast<uint8_t>(frame[data_start + 1]);
  if (response_cmd != expected_command + 1) {
    return pw::Status::DataLoss();
  }

  // Validate DCS
  uint8_t dcs = static_cast<uint8_t>(frame[data_start + len]);
  if (!ValidateDataChecksum(frame.subspan(data_start, len), dcs)) {
    return pw::Status::DataLoss();
  }

  // Return payload (after TFI + CMD, before DCS)
  size_t payload_len = len - 2;
  return frame.subspan(data_start + 2, payload_len);
}

uint8_t Pn532Command::CalculateLengthChecksum(uint8_t len) {
  return static_cast<uint8_t>(~len + 1);
}

uint8_t Pn532Command::CalculateDataChecksum(pw::ConstByteSpan data) {
  uint8_t sum = 0;
  for (auto b : data) {
    sum += static_cast<uint8_t>(b);
  }
  return static_cast<uint8_t>(~sum + 1);
}

bool Pn532Command::ValidateLengthChecksum(uint8_t len, uint8_t lcs) {
  return ((len + lcs) & 0xFF) == 0;
}

bool Pn532Command::ValidateDataChecksum(pw::ConstByteSpan data, uint8_t dcs) {
  uint8_t sum = 0;
  for (auto b : data) {
    sum += static_cast<uint8_t>(b);
  }
  return ((sum + dcs) & 0xFF) == 0;
}

}  // namespace maco::nfc
