// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <cstdint>
#include <optional>

#include "async_util/status_coro_task.h"
#include "gateway/gateway_client.h"
#include "gateway/gateway_service.pb.h"
#include "gateway/gateway_service.rpc.pb.h"
#include "maco_firmware/modules/app_state/system_state.h"
#include "pw_allocator/allocator.h"
#include "pw_async2/coro.h"
#include "pw_async2/time_provider.h"
#include "pw_async2/value_future.h"
#include "pw_chrono/system_clock.h"
#include "pw_rpc/nanopb/client_reader_writer.h"
#include "pw_status/status.h"

namespace maco::gateway {

/// What the terminal reports with every ping; the gateway forwards it to
/// the cloud (ADR-0045, phase 2c). Fixed for the lifetime of a boot — the
/// uptime that goes with it is read per ping.
struct TerminalStatus {
  const char* version = "";
  uint32_t reset_reason = 0;  // maco::system::ResetReason
  uint32_t boot_count = 0;    // consecutive incomplete boots (ADR-0040)
};

/// Periodically pings the gateway and pushes connectivity state to SystemState.
///
/// Uses the GatewayService::Ping RPC for application-level health checks,
/// replacing the unreliable TCP socket state check.
///
/// Startup: waits for wifi, pings twice with a short retry, then calls
/// SetReady() regardless of outcome to unblock the splash screen.
/// Steady state: pings every 15 seconds.
class GatewayConnectionCheck {
 public:
  GatewayConnectionCheck(
      GatewayClient& gateway,
      app_state::SystemState& system_state,
      pw::async2::TimeProvider<pw::chrono::SystemClock>& time_provider,
      pw::allocator::Allocator& allocator,
      TerminalStatus status = {});

  void Start(pw::async2::Dispatcher& dispatcher);

 private:
  pw::async2::Coro<pw::Status> Run(pw::async2::CoroContext cx);
  pw::async2::Coro<pw::Status> Ping(pw::async2::CoroContext cx);

  GatewayClient& gateway_;
  app_state::SystemState& system_state_;
  pw::async2::TimeProvider<pw::chrono::SystemClock>& time_provider_;
  TerminalStatus status_;

  using PingCall = pw::rpc::NanopbUnaryReceiver<maco_gateway_PingResponse>;
  pw::async2::ValueProvider<pw::Status> ping_provider_;
  PingCall ping_call_;

  pw::async2::CoroContext coro_cx_;
  std::optional<maco::async_util::StatusCoroTask> task_;
};

}  // namespace maco::gateway
