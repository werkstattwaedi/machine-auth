// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/services/maco_service.h"

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

pw::Status MacoService::Echo(const ::maco::pwpb::EchoMessage::Message& request,
                             ::maco::pwpb::EchoMessage::Message& response) {
  PW_LOG_INFO("Echo RPC called with %zu bytes", request.data.size());
  response.data.assign(request.data.begin(), request.data.end());
  return pw::OkStatus();
}

pw::Status MacoService::GetDeviceInfo(
    const ::maco::pwpb::Empty::Message& /*request*/,
    ::maco::pwpb::DeviceInfoResponse::Message& response) {
  PW_LOG_INFO("GetDeviceInfo RPC called");

  // Set firmware version
  response.firmware_version.assign(kFirmwareVersion);

  // Calculate uptime in milliseconds
  auto now = pw::chrono::SystemClock::now();
  auto uptime_ms = std::chrono::duration_cast<std::chrono::milliseconds>(
                       now.time_since_epoch())
                       .count();
  response.uptime_ms = static_cast<uint32_t>(uptime_ms);

  // Set build target
  response.build_target.assign(kBuildTarget);

  return pw::OkStatus();
}

}  // namespace maco
