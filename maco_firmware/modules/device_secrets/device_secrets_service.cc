// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/modules/device_secrets/device_secrets_service.h"

#include <cstring>

#include "pw_log/log.h"

namespace maco::secrets {

DeviceSecretsService::DeviceSecretsService(DeviceSecretsEeprom& storage)
    : storage_(storage) {}

pw::Status DeviceSecretsService::GetStatus(
    const ::maco_secrets_Empty& /*request*/,
    ::maco_secrets_StatusResponse& response) {
  response.is_provisioned = storage_.IsProvisioned();
  PW_LOG_INFO("DeviceSecretsService.GetStatus: is_provisioned=%d",
              response.is_provisioned);
  return pw::OkStatus();
}

pw::Status DeviceSecretsService::Provision(
    const ::maco_secrets_ProvisionRequest& request,
    ::maco_secrets_ProvisionResponse& response) {
  PW_LOG_INFO("DeviceSecretsService.Provision called");

  // Check if already provisioned
  if (storage_.IsProvisioned()) {
    std::strncpy(response.error, "Already provisioned. Call Clear() first.",
                 sizeof(response.error) - 1);
    response.error[sizeof(response.error) - 1] = '\0';
    response.success = false;
    PW_LOG_WARN("Provision failed: already provisioned");
    return pw::OkStatus();  // RPC succeeds, but response indicates failure
  }

  // Validate key sizes (should be enforced by proto options, but double-check)
  constexpr size_t kExpectedKeySize = 16;
  if (request.gateway_master_secret.size != kExpectedKeySize ||
      request.ntag_terminal_key.size != kExpectedKeySize) {
    std::strncpy(response.error, "Invalid key size",
                 sizeof(response.error) - 1);
    response.error[sizeof(response.error) - 1] = '\0';
    response.success = false;
    PW_LOG_ERROR("Provision failed: invalid key size");
    return pw::OkStatus();
  }

  // Create KeyBytes from request (nanopb PB_BYTES_ARRAY_T has .bytes[])
  auto gateway_secret_result = KeyBytes::FromBytes(pw::ConstByteSpan(
      reinterpret_cast<const std::byte*>(request.gateway_master_secret.bytes),
      request.gateway_master_secret.size));
  auto ntag_key_result = KeyBytes::FromBytes(pw::ConstByteSpan(
      reinterpret_cast<const std::byte*>(request.ntag_terminal_key.bytes),
      request.ntag_terminal_key.size));

  if (!gateway_secret_result.ok() || !ntag_key_result.ok()) {
    std::strncpy(response.error, "Invalid key bytes",
                 sizeof(response.error) - 1);
    response.error[sizeof(response.error) - 1] = '\0';
    response.success = false;
    PW_LOG_ERROR("Provision failed: invalid key bytes");
    return pw::OkStatus();
  }

  // Provision to EEPROM
  pw::Status status = storage_.Provision(*gateway_secret_result, *ntag_key_result);
  if (!status.ok()) {
    std::strncpy(response.error, "EEPROM write failed",
                 sizeof(response.error) - 1);
    response.error[sizeof(response.error) - 1] = '\0';
    response.success = false;
    PW_LOG_ERROR("Provision failed: EEPROM write error");
    return pw::OkStatus();
  }

  response.success = true;
  response.error[0] = '\0';
  PW_LOG_INFO("Device secrets provisioned successfully");
  return pw::OkStatus();
}

pw::Status DeviceSecretsService::Clear(
    const ::maco_secrets_Empty& /*request*/,
    ::maco_secrets_ProvisionResponse& response) {
  PW_LOG_WARN("DeviceSecretsService.Clear called - erasing secrets");
  storage_.Clear();
  response.success = true;
  response.error[0] = '\0';
  return pw::OkStatus();
}

}  // namespace maco::secrets
