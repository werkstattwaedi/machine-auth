// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <atomic>

#include "device_config/device_config.h"
#include "gateway/gateway_client.h"
#include "gateway/gateway_service.pb.h"
#include "gateway/gateway_service.rpc.pb.h"
#include "maco_firmware/modules/machine_control/machine_toggle.h"
#include "pw_async2/coro.h"
#include "pw_async2/time_provider.h"
#include "pw_async2/value_future.h"
#include "pw_chrono/system_clock.h"
#include "pw_rpc/nanopb/client_reader_writer.h"
#include "pw_status/status.h"

namespace maco::machine_control {

/// Switches the machine through the gateway (SetPower) instead of the
/// terminal's relay — e.g. a Shelly 1PM in front of the CNC mill (ADR-0054).
///
/// The terminal can't read the switch at boot, so the state starts as "on":
/// an involuntary reset mid-session then resumes the session (like a relay
/// still latched on) instead of cutting power and losing the homing. Any other
/// boot path issues the controller's fail-safe Disable, which switches it off.
class GatewayMachineToggle : public MachineToggle {
 public:
  GatewayMachineToggle(
      gateway::GatewayClient& gateway,
      const config::GatewaySensingConfig& config,
      pw::async2::TimeProvider<pw::chrono::SystemClock>& time_provider);

  pw::Status Init() override { return pw::OkStatus(); }
  bool IsEnabled() const override {
    return enabled_.load(std::memory_order_relaxed);
  }
  pw::async2::Coro<pw::Status> Enable(pw::async2::CoroContext cx) override;
  pw::async2::Coro<pw::Status> Disable(pw::async2::CoroContext cx) override;

 private:
  /// Retry SetPower(on) up to `attempts` times; OK once the device confirmed.
  pw::async2::Coro<pw::Status> SetPowerWithRetry(pw::async2::CoroContext cx,
                                                 bool on,
                                                 int attempts);
  pw::async2::Coro<pw::Status> SetPowerOnce(pw::async2::CoroContext cx,
                                            bool on);

  gateway::GatewayClient& gateway_;
  // Referenced: lives in the static DeviceConfig (see GatewayMachineSensor).
  const config::GatewaySensingConfig& config_;
  pw::async2::TimeProvider<pw::chrono::SystemClock>& time_provider_;
  std::atomic<bool> enabled_{true};

  using SetPowerCall =
      pw::rpc::NanopbUnaryReceiver<maco_gateway_SetPowerResponse>;
  pw::async2::ValueProvider<pw::Result<maco_gateway_SetPowerResponse>>
      provider_;
  SetPowerCall call_;
};

}  // namespace maco::machine_control
