// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/services/maco_service.h"

#include <cstring>

#include "pw_chrono/system_clock.h"
#include "pw_log/log.h"

namespace maco {
namespace {

// Firmware version - update on releases
constexpr const char* kFirmwareVersion = "0.1.0-dev";

// Build target identifier set at compile time
#if defined(__arm__)
constexpr const char* kBuildTarget = "p2";
#else
constexpr const char* kBuildTarget = "host";
#endif

}  // namespace

pw::Status MacoService::Echo(const ::maco_EchoMessage& request,
                             ::maco_EchoMessage& response) {
  PW_LOG_INFO("Echo RPC called with %zu bytes",
              static_cast<size_t>(request.data.size));
  std::memcpy(response.data.bytes, request.data.bytes, request.data.size);
  response.data.size = request.data.size;
  return pw::OkStatus();
}

pw::Status MacoService::GetDeviceInfo(const ::maco_Empty& /*request*/,
                                      ::maco_DeviceInfoResponse& response) {
  PW_LOG_INFO("GetDeviceInfo RPC called");

  // Set firmware version
  std::strncpy(response.firmware_version, kFirmwareVersion,
               sizeof(response.firmware_version) - 1);
  response.firmware_version[sizeof(response.firmware_version) - 1] = '\0';

  // Calculate uptime in milliseconds
  auto now = pw::chrono::SystemClock::now();
  auto uptime_ms = std::chrono::duration_cast<std::chrono::milliseconds>(
                       now.time_since_epoch())
                       .count();
  response.uptime_ms = static_cast<uint32_t>(uptime_ms);

  // Set build target
  std::strncpy(response.build_target, kBuildTarget,
               sizeof(response.build_target) - 1);
  response.build_target[sizeof(response.build_target) - 1] = '\0';

  return pw::OkStatus();
}

}  // namespace maco
