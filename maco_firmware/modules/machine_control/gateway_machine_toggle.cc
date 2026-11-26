// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#define PW_LOG_MODULE_NAME "GTGL"

#include "maco_firmware/modules/machine_control/gateway_machine_toggle.h"

#include "maco_firmware/modules/machine_control/gateway_machine_sensor.h"
#include "pw_async2/future_timeout.h"
#include "pw_log/log.h"

namespace maco::machine_control {

using namespace std::chrono_literals;
using GatewayServiceClient =
    maco::gateway::pw_rpc::nanopb::GatewayService::Client;

namespace {
// Each attempt is bounded so a lost reply can't stall the controller loop.
constexpr auto kRpcDeadline = 5s;
constexpr auto kRetryDelay = 2s;
// Switching on is what the person waits for at the machine: fail fast, the
// session ends and they can tap again.
constexpr int kEnableAttempts = 2;
// Switching off must land even right after boot, before the gateway link is
// up; the gateway's backstop catches whatever this misses.
constexpr int kDisableAttempts = 6;
}  // namespace

GatewayMachineToggle::GatewayMachineToggle(
    gateway::GatewayClient& gateway,
    const config::GatewaySensingConfig& config,
    pw::async2::TimeProvider<pw::chrono::SystemClock>& time_provider)
    : gateway_(gateway), config_(config), time_provider_(time_provider) {}

pw::async2::Coro<pw::Status> GatewayMachineToggle::Enable(
    pw::async2::CoroContext cx) {
  pw::Status st = co_await SetPowerWithRetry(cx, true, kEnableAttempts);
  if (st.ok()) {
    enabled_.store(true, std::memory_order_relaxed);
  }
  co_return st;
}

pw::async2::Coro<pw::Status> GatewayMachineToggle::Disable(
    pw::async2::CoroContext cx) {
  pw::Status st = co_await SetPowerWithRetry(cx, false, kDisableAttempts);
  if (st.ok()) {
    enabled_.store(false, std::memory_order_relaxed);
  }
  co_return st;
}

pw::async2::Coro<pw::Status> GatewayMachineToggle::SetPowerWithRetry(
    pw::async2::CoroContext cx, bool on, int attempts) {
  pw::Status st = pw::Status::Unavailable();
  for (int i = 0; i < attempts; ++i) {
    if (i > 0) {
      co_await time_provider_.WaitFor(kRetryDelay);
    }
    st = co_await SetPowerOnce(cx, on);
    if (st.ok()) {
      co_return st;
    }
    PW_LOG_WARN("SetPower(%s) attempt %d failed: %d", on ? "on" : "off", i + 1,
                static_cast<int>(st.code()));
  }
  co_return st;
}

pw::async2::Coro<pw::Status> GatewayMachineToggle::SetPowerOnce(
    [[maybe_unused]] pw::async2::CoroContext cx, bool on) {
  maco_gateway_SetPowerRequest request = maco_gateway_SetPowerRequest_init_zero;
  request.has_spec = true;
  BuildSensingSpec(config_, request.spec);
  request.on = on;

  // Register the future BEFORE the RPC (callback may fire synchronously).
  auto future = provider_.Get();
  GatewayServiceClient client(gateway_.rpc_client(), gateway_.channel_id());
  call_ = client.SetPower(
      request,
      [this](const maco_gateway_SetPowerResponse& resp, pw::Status st) {
        st.ok() ? provider_.Resolve(resp) : provider_.Resolve(st);
      },
      [this](pw::Status st) { provider_.Resolve(st); });

  auto timed =
      co_await pw::async2::Timeout(std::move(future), time_provider_,
                                   kRpcDeadline);
  if (!timed.ok()) {
    call_.Cancel().IgnoreError();
    co_return timed.status();
  }
  auto& result = *timed;
  if (!result.ok()) {
    co_return result.status();
  }
  if (!result->reachable) {
    co_return pw::Status::Unavailable();
  }
  if (!result->ok) {
    co_return pw::Status::FailedPrecondition();
  }
  co_return pw::OkStatus();
}

}  // namespace maco::machine_control
