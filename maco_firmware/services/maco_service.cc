// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/services/maco_service.h"

#include <cstdint>
#include <cstring>

#include "pw_assert/check.h"
#include "pw_async2/dispatcher.h"
#include "pw_async2/task.h"
#include "pw_chrono/system_clock.h"
#include "pw_log/log.h"
#include "pw_system/system.h"

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

// TEMPORARY (ADR-0040 watchdog verification) — remove after on-device testing.
// A task that wedges the pw_system dispatcher by spinning forever without
// yielding. Once the dispatcher thread is stuck here, the watchdog heartbeat
// coroutine can no longer run, the feeder thread stops feeding, and the
// hardware IWDG resets the device (~30s on the prod build).
class DispatcherWedge : public pw::async2::Task {
 private:
  pw::async2::Poll<> DoPend(pw::async2::Context& /*cx*/) override {
    PW_LOG_WARN("TEST: dispatcher wedged; hardware watchdog should reset soon");
    // `volatile` so the compiler cannot delete this otherwise-side-effect-free
    // (and therefore UB) infinite loop.
    static volatile uint32_t spin = 0;
    for (;;) {
      spin = spin + 1;
    }
  }
};

}  // namespace

pw::Status MacoService::HangDispatcher(const ::maco_Empty& /*request*/,
                                       ::maco_Empty& /*response*/) {
  PW_LOG_WARN("TEST: HangDispatcher RPC — posting a dispatcher wedge");
  static DispatcherWedge wedge;
  pw::System().dispatcher().Post(wedge);
  return pw::OkStatus();
}

pw::Status MacoService::Crash(const ::maco_Empty& /*request*/,
                              ::maco_Empty& /*response*/) {
  PW_LOG_WARN("TEST: Crash RPC — forcing an assertion failure");
  PW_CHECK(false, "TEST: forced crash for ADR-0040 verification");
  return pw::OkStatus();  // unreachable
}

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
