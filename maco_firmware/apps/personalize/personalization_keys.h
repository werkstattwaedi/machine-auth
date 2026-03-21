// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <array>
#include <cstddef>

#include "pw_string/string.h"

namespace maco::personalize {

/// Maximum length of the SDM base URL (e.g. "id.werkstattwaedi.ch/").
constexpr size_t kMaxSdmBaseUrlLength = 64;

/// Pre-diversified keys and SDM config for NTAG424 tag personalization.
/// Delivered from the console (Python) to the device over RPC.
struct PersonalizationKeys {
  std::array<std::byte, 16> application_key;
  std::array<std::byte, 16> terminal_key;
  std::array<std::byte, 16> authorization_key;
  std::array<std::byte, 16> sdm_mac_key;
  std::array<std::byte, 16> reserved2_key;

  /// SDM base URL (without "https://", e.g. "id.werkstattwaedi.ch/").
  /// The NDEF template will be: https://<sdm_base_url>?picc=...&cmac=...
  pw::InlineString<kMaxSdmBaseUrlLength> sdm_base_url;
};

}  // namespace maco::personalize
