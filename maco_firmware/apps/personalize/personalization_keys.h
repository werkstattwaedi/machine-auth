// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <array>
#include <cstddef>

namespace maco::personalize {

/// Pre-diversified keys for NTAG424 tag personalization.
/// Delivered from the console (Python) to the device over RPC.
struct PersonalizationKeys {
  std::array<std::byte, 16> application_key;
  std::array<std::byte, 16> terminal_key;
  std::array<std::byte, 16> authorization_key;
  std::array<std::byte, 16> sdm_mac_key;
  std::array<std::byte, 16> reserved2_key;
};

}  // namespace maco::personalize
