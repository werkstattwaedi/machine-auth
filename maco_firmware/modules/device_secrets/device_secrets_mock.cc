// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/modules/device_secrets/device_secrets_mock.h"

namespace maco::secrets {

namespace {

// Well-known test secrets matching gateway_process.py DEFAULT_TEST_MASTER_KEY
constexpr std::array<std::byte, KeyBytes::kSize> kDefaultGatewayMasterSecret = {
    std::byte{0x00}, std::byte{0x01}, std::byte{0x02}, std::byte{0x03},
    std::byte{0x04}, std::byte{0x05}, std::byte{0x06}, std::byte{0x07},
    std::byte{0x08}, std::byte{0x09}, std::byte{0x0A}, std::byte{0x0B},
    std::byte{0x0C}, std::byte{0x0D}, std::byte{0x0E}, std::byte{0x0F},
};

// Shared terminal key matching functions/.env.local TERMINAL_KEY.
// Same key on all tags — enables local auth + real UID retrieval.
constexpr std::array<std::byte, KeyBytes::kSize> kDefaultNtagTerminalKey = {
    std::byte{0xF5}, std::byte{0xE4}, std::byte{0xB9}, std::byte{0x99},
    std::byte{0xD5}, std::byte{0xAA}, std::byte{0x62}, std::byte{0x9F},
    std::byte{0x19}, std::byte{0x3A}, std::byte{0x87}, std::byte{0x45},
    std::byte{0x29}, std::byte{0xC4}, std::byte{0xAA}, std::byte{0x2F},
};

}  // namespace

DeviceSecretsMock::DeviceSecretsMock()
    : gateway_master_secret_(kDefaultGatewayMasterSecret),
      ntag_terminal_key_(kDefaultNtagTerminalKey) {}

bool DeviceSecretsMock::IsProvisioned() const {
  return gateway_master_secret_.has_value() && ntag_terminal_key_.has_value();
}

pw::Result<KeyBytes> DeviceSecretsMock::GetGatewayMasterSecret() const {
  if (!gateway_master_secret_.has_value()) {
    return pw::Status::NotFound();
  }
  return KeyBytes::FromArray(*gateway_master_secret_);
}

pw::Result<KeyBytes> DeviceSecretsMock::GetNtagTerminalKey() const {
  if (!ntag_terminal_key_.has_value()) {
    return pw::Status::NotFound();
  }
  return KeyBytes::FromArray(*ntag_terminal_key_);
}

void DeviceSecretsMock::SetSecrets(const KeyBytes& gateway_master_secret,
                                   const KeyBytes& ntag_terminal_key) {
  gateway_master_secret_ = gateway_master_secret.array();
  ntag_terminal_key_ = ntag_terminal_key.array();
}

void DeviceSecretsMock::Clear() {
  gateway_master_secret_.reset();
  ntag_terminal_key_.reset();
}

}  // namespace maco::secrets
