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

constexpr std::array<std::byte, KeyBytes::kSize> kDefaultNtagTerminalKey = {
    std::byte{0x10}, std::byte{0x11}, std::byte{0x12}, std::byte{0x13},
    std::byte{0x14}, std::byte{0x15}, std::byte{0x16}, std::byte{0x17},
    std::byte{0x18}, std::byte{0x19}, std::byte{0x1A}, std::byte{0x1B},
    std::byte{0x1C}, std::byte{0x1D}, std::byte{0x1E}, std::byte{0x1F},
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
