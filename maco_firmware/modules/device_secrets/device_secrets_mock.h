// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

/// @file device_secrets_mock.h
/// @brief Mock implementation of DeviceSecrets for host simulator and tests.

#include <array>
#include <cstddef>
#include <optional>

#include "device_secrets/device_secrets.h"
#include "maco_firmware/types.h"
#include "pw_result/result.h"

namespace maco::secrets {

/// In-memory mock implementation of DeviceSecrets.
///
/// Used for:
/// - Host simulator (no EEPROM available)
/// - Unit tests requiring controlled secret values
///
/// Ships with well-known test secrets by default (IsProvisioned() == true).
/// Use Clear() or SetSecrets() to override.
class DeviceSecretsMock : public DeviceSecrets {
 public:
  /// Construct with well-known test secrets.
  DeviceSecretsMock();

  // DeviceSecrets interface
  bool IsProvisioned() const override;
  pw::Result<KeyBytes> GetGatewayMasterSecret() const override;
  pw::Result<KeyBytes> GetNtagTerminalKey() const override;

  /// Set mock secrets programmatically.
  void SetSecrets(const KeyBytes& gateway_master_secret,
                  const KeyBytes& ntag_terminal_key);

  /// Clear all secrets (mark as unprovisioned).
  void Clear();

 private:
  std::optional<std::array<std::byte, KeyBytes::kSize>> gateway_master_secret_;
  std::optional<std::array<std::byte, KeyBytes::kSize>> ntag_terminal_key_;
};

}  // namespace maco::secrets
