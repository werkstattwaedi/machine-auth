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
  PW_LOG_INFO("DeviceSecretsService.Provision called (force=%d)",
              request.force);

  // Already-provisioned guard: bail out unless caller explicitly asked
  // to overwrite. With force=true we clear first so Provision is a
  // single-step re-key.
  if (storage_.IsProvisioned()) {
    if (!request.force) {
      std::strncpy(response.error,
                   "Already provisioned. Re-run with force=true.",
                   sizeof(response.error) - 1);
      response.error[sizeof(response.error) - 1] = '\0';
      response.success = false;
      PW_LOG_WARN("Provision failed: already provisioned (force=false)");
      return pw::OkStatus();
    }
    PW_LOG_WARN("Provision force=true: clearing existing secrets");
    storage_.Clear();
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

namespace {

// Constant-time equality over two byte spans of equal length.
bool ConstantTimeEqual(pw::ConstByteSpan a, pw::ConstByteSpan b) {
  if (a.size() != b.size()) {
    return false;
  }
  unsigned char diff = 0;
  for (size_t i = 0; i < a.size(); ++i) {
    diff |= static_cast<unsigned char>(a[i]) ^
            static_cast<unsigned char>(b[i]);
  }
  return diff == 0;
}

}  // namespace

pw::Status DeviceSecretsService::Verify(
    const ::maco_secrets_ProvisionRequest& request,
    ::maco_secrets_VerifyResponse& response) {
  response.is_provisioned = storage_.IsProvisioned();
  response.gateway_match = false;
  response.ntag_match = false;

  if (!response.is_provisioned) {
    PW_LOG_INFO("DeviceSecretsService.Verify: not provisioned");
    return pw::OkStatus();
  }

  auto stored_gateway = storage_.GetGatewayMasterSecret();
  auto stored_ntag = storage_.GetNtagTerminalKey();
  if (!stored_gateway.ok() || !stored_ntag.ok()) {
    // Provisioned-bit set but read back failed — treat as mismatch.
    PW_LOG_ERROR("DeviceSecretsService.Verify: failed to read stored keys");
    return pw::OkStatus();
  }

  const auto candidate_gateway = pw::ConstByteSpan(
      reinterpret_cast<const std::byte*>(request.gateway_master_secret.bytes),
      request.gateway_master_secret.size);
  const auto candidate_ntag = pw::ConstByteSpan(
      reinterpret_cast<const std::byte*>(request.ntag_terminal_key.bytes),
      request.ntag_terminal_key.size);

  response.gateway_match =
      ConstantTimeEqual(candidate_gateway, stored_gateway->bytes());
  response.ntag_match =
      ConstantTimeEqual(candidate_ntag, stored_ntag->bytes());

  PW_LOG_INFO("DeviceSecretsService.Verify: gateway=%d ntag=%d",
              response.gateway_match, response.ntag_match);
  return pw::OkStatus();
}

}  // namespace maco::secrets
