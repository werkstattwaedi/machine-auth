// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

/// @file device_secrets.h
/// @brief Public interface for device secrets storage.
///
/// Provides access to factory-provisioned cryptographic secrets stored
/// in persistent storage (EEPROM on P2). The internal storage format
/// (protobuf) is not exposed - all access is through KeyBytes.
///
/// Secrets are provisioned via the DeviceSecretsService RPC during
/// factory setup. This interface is read-only.

#include "maco_firmware/types.h"
#include "pw_result/result.h"

namespace maco::secrets {

/// Abstract interface for device secrets storage.
///
/// Implementations:
/// - DeviceSecretsEeprom (P2): EEPROM-backed persistent storage
/// - DeviceSecretsMock (host): File-backed or in-memory for testing
class DeviceSecrets {
 public:
  virtual ~DeviceSecrets() = default;

  /// Check if secrets have been provisioned.
  ///
  /// @return true if all required secrets are available
  virtual bool IsProvisioned() const = 0;

  /// Get the gateway master secret for ASCON key derivation.
  ///
  /// This secret is combined with the device ID to derive the per-device
  /// ASCON encryption key for gateway communication.
  ///
  /// @return 16-byte master secret, or NotFound if not provisioned
  virtual pw::Result<KeyBytes> GetGatewayMasterSecret() const = 0;

  /// Get the NTAG 424 DNA terminal key (KEY_TERMINAL, slot 2).
  ///
  /// This key is used for mutual authentication with NTAG 424 tags
  /// during terminal check-in. The key must match the key provisioned
  /// on the tags.
  ///
  /// @return 16-byte terminal key, or NotFound if not provisioned
  virtual pw::Result<KeyBytes> GetNtagTerminalKey() const = 0;
};

}  // namespace maco::secrets
