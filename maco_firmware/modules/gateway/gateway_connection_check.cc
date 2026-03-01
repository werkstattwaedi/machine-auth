// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#define PW_LOG_MODULE_NAME "GWCK"

#include "gateway/gateway_connection_check.h"

#include "pw_log/log.h"

namespace maco::gateway {

using namespace std::chrono_literals;
using GatewayServiceClient =
    maco::gateway::pw_rpc::nanopb::GatewayService::Client;

constexpr auto kPingInterval = 15s;
constexpr auto kWifiPollInterval = 1s;
constexpr auto kStartupRetryDelay = 2s;

GatewayConnectionCheck::GatewayConnectionCheck(
    GatewayClient& gateway,
    app_state::SystemState& system_state,
    pw::async2::TimeProvider<pw::chrono::SystemClock>& time_provider,
    pw::allocator::Allocator& allocator)
    : gateway_(gateway),
      system_state_(system_state),
      time_provider_(time_provider),
      coro_cx_(allocator) {}

void GatewayConnectionCheck::Start(pw::async2::Dispatcher& dispatcher) {
  auto coro = Run(coro_cx_);
  task_.emplace(std::move(coro), [](pw::Status s) {
    PW_LOG_ERROR("Gateway connection check failed: %d",
                 static_cast<int>(s.code()));
  });
  dispatcher.Post(*task_);
}

pw::async2::Coro<pw::Status> GatewayConnectionCheck::Ping(
    [[maybe_unused]] pw::async2::CoroContext& cx) {
  maco_gateway_PingRequest request = maco_gateway_PingRequest_init_zero;

  // Register future BEFORE starting RPC (callback may fire synchronously).
  auto future = ping_provider_.Get();

  GatewayServiceClient client(gateway_.rpc_client(), gateway_.channel_id());
  ping_call_ = client.Ping(
      request,
      [this](const maco_gateway_PingResponse& /*resp*/, pw::Status st) {
        ping_provider_.Resolve(st);
      },
      [this](pw::Status st) { ping_provider_.Resolve(st); });

  co_return co_await std::move(future);
}

pw::async2::Coro<pw::Status> GatewayConnectionCheck::Run(
    pw::async2::CoroContext& cx) {
  // Phase 1: Wait for wifi before attempting any pings.
  {
    app_state::SystemStateSnapshot snapshot;
    system_state_.GetSnapshot(snapshot);
    while (snapshot.wifi_state != app_state::WifiState::kConnected) {
      co_await time_provider_.WaitFor(kWifiPollInterval);
      system_state_.GetSnapshot(snapshot);
    }
    PW_LOG_INFO("Wifi connected, starting gateway ping");
  }

  // Phase 2: Startup — ping with one quick retry, then unblock UI.
  {
    pw::Status result = co_await Ping(cx);
    system_state_.SetGatewayConnected(result.ok());

    if (!result.ok()) {
      PW_LOG_WARN("First gateway ping failed, retrying in 2s");
      co_await time_provider_.WaitFor(kStartupRetryDelay);

      result = co_await Ping(cx);
      system_state_.SetGatewayConnected(result.ok());
    }

    if (result.ok()) {
      PW_LOG_INFO("Gateway connected");
    } else {
      PW_LOG_WARN("Gateway unreachable — continuing without connection");
    }
    system_state_.SetReady();
  }

  // Phase 3: Steady-state periodic pings.
  while (true) {
    co_await time_provider_.WaitFor(kPingInterval);

    pw::Status result = co_await Ping(cx);
    system_state_.SetGatewayConnected(result.ok());

    if (result.ok()) {
      PW_LOG_DEBUG("Gateway ping OK");
    } else {
      PW_LOG_WARN("Gateway ping failed: %d",
                  static_cast<int>(result.code()));
    }
  }

  co_return pw::OkStatus();
}

}  // namespace maco::gateway
