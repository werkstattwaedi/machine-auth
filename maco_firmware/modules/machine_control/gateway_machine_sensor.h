// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <atomic>
#include <optional>

#include "device_config/device_config.h"
#include "gateway/gateway_client.h"
#include "gateway/gateway_service.pb.h"
#include "gateway/gateway_service.rpc.pb.h"
#include "maco_firmware/modules/app_state/session_fsm.h"
#include "maco_firmware/modules/machine_control/machine_sensor.h"
#include "pw_allocator/allocator.h"
#include "pw_async2/coro.h"
#include "pw_async2/coro_or_else_task.h"
#include "pw_async2/dispatcher.h"
#include "pw_async2/time_provider.h"
#include "pw_async2/value_future.h"
#include "pw_chrono/system_clock.h"
#include "pw_rpc/nanopb/client_reader_writer.h"
#include "pw_status/status.h"
#include "pw_string/string.h"

namespace maco::machine_control {

/// Senses machine activity by leasing a sensing session from the gateway
/// (ADR-0035). The gateway runs the device-specific protocol (e.g. the xTool
/// laser's WebSocket) and reports running/idle; this sensor forwards its
/// SensingSpec, polls via a lease, and drives NotifyRunning().
///
/// Session-scoped: it leases and polls only while a session is active (driven
/// by the SessionObserver hooks), so the gateway holds the device connection
/// open only during real use. Runs entirely on the shared async2 dispatcher —
/// no dedicated thread (the gateway RPC read is async), unlike the removed
/// XToolMachineSensor which had to poll blocking TCP on its own thread.
class GatewayMachineSensor : public MachineSensor,
                             public app_state::SessionObserver {
 public:
  GatewayMachineSensor(
      gateway::GatewayClient& gateway,
      const config::GatewaySensingConfig& config,
      pw::async2::TimeProvider<pw::chrono::SystemClock>& time_provider,
      pw::allocator::Allocator& allocator);

  // MachineSensor
  void Start(pw::async2::Dispatcher& dispatcher) override;

  // SessionObserver — gate polling on session lifetime.
  void OnSessionStarted(const app_state::SessionInfo& session) override;
  void OnSessionEnded(const app_state::SessionInfo& session,
                      const app_state::MachineUsage& usage) override;

 private:
  pw::async2::Coro<pw::Status> Run(pw::async2::CoroContext cx);
  pw::async2::Coro<pw::Status> Acquire(pw::async2::CoroContext cx);
  pw::async2::Coro<pw::Status> Renew(pw::async2::CoroContext cx);
  void ApplyState(bool valid, maco_gateway_SensingState state);
  void BuildSpec(maco_gateway_SensingSpec& spec) const;

  gateway::GatewayClient& gateway_;
  const config::GatewaySensingConfig config_;
  pw::async2::TimeProvider<pw::chrono::SystemClock>& time_provider_;

  std::atomic<bool> session_active_{false};
  bool have_lease_ = false;
  pw::InlineString<40> lease_id_;

  using LeaseCall =
      pw::rpc::NanopbUnaryReceiver<maco_gateway_SensingLeaseResponse>;
  pw::async2::ValueProvider<pw::Result<maco_gateway_SensingLeaseResponse>>
      lease_provider_;
  LeaseCall lease_call_;

  pw::async2::CoroContext coro_cx_;
  std::optional<pw::async2::CoroOrElseTask> task_;
};

}  // namespace maco::machine_control
