// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <optional>

#include "gateway/gateway_client.h"
#include "gateway/gateway_service.pb.h"
#include "gateway/gateway_service.rpc.pb.h"
#include "maco_firmware/modules/app_state/system_state.h"
#include "pw_allocator/allocator.h"
#include "pw_async2/coro.h"
#include "pw_async2/coro_or_else_task.h"
#include "pw_async2/time_provider.h"
#include "pw_async2/value_future.h"
#include "pw_chrono/system_clock.h"
#include "pw_rpc/nanopb/client_reader_writer.h"
#include "pw_status/status.h"

namespace maco::gateway {

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
      pw::allocator::Allocator& allocator);

  void Start(pw::async2::Dispatcher& dispatcher);

 private:
  pw::async2::Coro<pw::Status> Run(pw::async2::CoroContext& cx);
  pw::async2::Coro<pw::Status> Ping(pw::async2::CoroContext& cx);

  GatewayClient& gateway_;
  app_state::SystemState& system_state_;
  pw::async2::TimeProvider<pw::chrono::SystemClock>& time_provider_;

  using PingCall = pw::rpc::NanopbUnaryReceiver<maco_gateway_PingResponse>;
  pw::async2::ValueProvider<pw::Status> ping_provider_;
  PingCall ping_call_;

  pw::async2::CoroContext coro_cx_;
  std::optional<pw::async2::CoroOrElseTask> task_;
};

}  // namespace maco::gateway
