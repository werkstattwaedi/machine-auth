// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

/// @file device_secrets_service.h
/// @brief RPC service for factory provisioning of device secrets.
///
/// Provides GetStatus, Provision, and Clear RPCs for managing
/// EEPROM-stored cryptographic secrets during factory setup.

#include "maco_firmware/modules/device_secrets/device_secrets_eeprom.h"
#include "maco_pb/device_secrets_service.rpc.pb.h"
#include "pw_status/status.h"

namespace maco::secrets {

/// RPC service for device secrets management.
///
/// This service wraps DeviceSecretsEeprom and exposes provisioning
/// operations via pw_rpc. It is registered with the RPC server during
/// system initialization.
class DeviceSecretsService final
    : public ::maco::secrets::pw_rpc::nanopb::DeviceSecretsService::Service<
          DeviceSecretsService> {
 public:
  /// Construct service with backing storage.
  ///
  /// @param storage EEPROM-backed storage implementation
  explicit DeviceSecretsService(DeviceSecretsEeprom& storage);

  /// Check if secrets have been provisioned.
  pw::Status GetStatus(const ::maco_secrets_Empty& request,
                       ::maco_secrets_StatusResponse& response);

  /// Provision device secrets.
  pw::Status Provision(const ::maco_secrets_ProvisionRequest& request,
                       ::maco_secrets_ProvisionResponse& response);

  /// Clear all provisioned secrets.
  pw::Status Clear(const ::maco_secrets_Empty& request,
                   ::maco_secrets_ProvisionResponse& response);

 private:
  DeviceSecretsEeprom& storage_;
};

}  // namespace maco::secrets
