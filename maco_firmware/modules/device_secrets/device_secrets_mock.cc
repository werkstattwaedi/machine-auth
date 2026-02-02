// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/modules/device_secrets/device_secrets_mock.h"

namespace maco::secrets {

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
