// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/apps/personalize/sdm_constants.h"

#include "pw_assert/check.h"

namespace maco::personalize::sdm {

pw::Result<NdefTemplate> BuildNdefTemplate(std::string_view base_url) {
  if (base_url.empty() || base_url.size() > kMaxBaseUrlLength) {
    return pw::Status::InvalidArgument();
  }

  const size_t url_total = base_url.size() + kUrlSuffixLength;
  // Payload = URI prefix code (1) + url_total
  const size_t payload_length = 1 + url_total;
  // NDEF message = header(3) + payload_length(1) + type(1) + payload
  const size_t ndef_message_length = 3 + payload_length;
  // Total file = NLEN(2) + NDEF message
  const size_t total_size = 2 + ndef_message_length;

  if (payload_length > 255) {
    return pw::Status::InvalidArgument();  // SR (Short Record) limit
  }

  NdefTemplate result{};
  result.size = total_size;
  size_t pos = 0;

  auto put = [&](uint8_t byte) {
    PW_DCHECK(pos < result.data.size());
    result.data[pos++] = std::byte{byte};
  };
  auto put_str = [&](std::string_view s) {
    for (char c : s) {
      PW_DCHECK(pos < result.data.size());
      result.data[pos++] = std::byte(static_cast<uint8_t>(c));
    }
  };
  auto put_zeros = [&](size_t count) {
    for (size_t i = 0; i < count; ++i) {
      PW_DCHECK(pos < result.data.size());
      result.data[pos++] = std::byte{'0'};
    }
  };

  // NLEN (2 bytes, big-endian)
  put(static_cast<uint8_t>((ndef_message_length >> 8) & 0xFF));
  put(static_cast<uint8_t>(ndef_message_length & 0xFF));

  // NDEF record header
  put(0xD1);  // MB+ME, SR, TNF=Well-Known
  put(0x01);  // Type Length
  put(static_cast<uint8_t>(payload_length));  // Payload Length
  put(0x55);  // Type 'U' (URI)
  put(0x04);  // URI prefix "https://"

  // Base URL
  put_str(base_url);

  // "?picc="
  put_str("?picc=");

  // PICC placeholder: 32 hex zeros (16 encrypted bytes)
  result.picc_data_offset = static_cast<uint8_t>(pos);
  put_zeros(32);

  // "&cmac="
  put_str("&cmac=");

  // CMAC placeholder: 16 hex zeros (8 CMAC bytes)
  result.sdm_mac_offset = static_cast<uint8_t>(pos);
  put_zeros(16);

  return result;
}

}  // namespace maco::personalize::sdm
