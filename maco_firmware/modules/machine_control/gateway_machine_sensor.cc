// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#define PW_LOG_MODULE_NAME "GSEN"

#include "maco_firmware/modules/machine_control/gateway_machine_sensor.h"

#include <cstdio>

#include "async_util/value_or_timeout.h"
#include "pw_log/log.h"

namespace maco::machine_control {

using namespace std::chrono_literals;
using GatewayServiceClient =
    maco::gateway::pw_rpc::nanopb::GatewayService::Client;

namespace {
// Bound each lease RPC so a link drop after the request went out can't hang the
// poll loop forever (mirrors gateway_connection_check's ping deadline).
constexpr auto kRpcDeadline = 5s;
// How often to check for a session while idle (between sessions).
constexpr auto kIdlePollInterval = 500ms;
// Lease lifetime without renewal. Must exceed the poll interval by a wide
// margin so a few dropped polls never expire the lease; the gateway drops the
// device connection this long after the terminal stops renewing.
constexpr uint32_t kLeaseTtlSec = 60;
}  // namespace

GatewayMachineSensor::GatewayMachineSensor(
    gateway::GatewayClient& gateway,
    const config::GatewaySensingConfig& config,
    pw::async2::TimeProvider<pw::chrono::SystemClock>& time_provider,
    pw::allocator::Allocator& allocator)
    : gateway_(gateway),
      config_(config),
      time_provider_(time_provider),
      coro_cx_(allocator) {}

void GatewayMachineSensor::Start(pw::async2::Dispatcher& dispatcher) {
  // Contract: report the initial state before the loop. No session yet, so the
  // machine is not running.
  NotifyRunning(false);
  if (config_.kind == config::SensingKind::kUnspecified) {
    PW_LOG_WARN("Gateway sensing has no resolved backend; sensor will stay idle");
  }
  auto coro = Run(coro_cx_);
  task_.emplace(std::move(coro), [](pw::Status s) {
    PW_LOG_ERROR("Gateway sensor loop failed: %d", static_cast<int>(s.code()));
  });
  dispatcher.Post(*task_);
}

void GatewayMachineSensor::OnSessionStarted(
    const app_state::SessionInfo& /*session*/) {
  session_active_.store(true, std::memory_order_relaxed);
}

void GatewayMachineSensor::OnSessionEnded(
    const app_state::SessionInfo& /*session*/,
    const app_state::MachineUsage& /*usage*/) {
  session_active_.store(false, std::memory_order_relaxed);
}

void GatewayMachineSensor::BuildSpec(maco_gateway_SensingSpec& spec) const {
  switch (config_.kind) {
    case config::SensingKind::kXToolLaser: {
      spec.which_backend = maco_gateway_SensingSpec_xtool_laser_tag;
      auto& x = spec.backend.xtool_laser;
      std::snprintf(x.host, sizeof(x.host), "%s", config_.host.c_str());
      x.port = config_.port;
      x.poll_interval_sec = config_.poll_interval_sec;
      break;
    }
    case config::SensingKind::kMock:
      spec.which_backend = maco_gateway_SensingSpec_mock_tag;
      break;
    default:
      break;
  }
}

void GatewayMachineSensor::ApplyState(bool valid,
                                      maco_gateway_SensingState state) {
  if (!valid) {
    // Lease expired/unknown — re-acquire; treat as not running for now.
    have_lease_ = false;
    NotifyRunning(false);
    return;
  }
  NotifyRunning(state == maco_gateway_SensingState_SENSING_STATE_RUNNING);
}

pw::async2::Coro<pw::Status> GatewayMachineSensor::Acquire(
    [[maybe_unused]] pw::async2::CoroContext cx) {
  // A gateway_sensing machine with no resolved backend arm is a config error;
  // don't send an invalid spec (BuildSpec would leave which_backend unset).
  if (config_.kind == config::SensingKind::kUnspecified) {
    co_return pw::Status::FailedPrecondition();
  }
  maco_gateway_AcquireSensingLeaseRequest request =
      maco_gateway_AcquireSensingLeaseRequest_init_zero;
  request.lease_ttl_sec = kLeaseTtlSec;
  request.has_spec = true;
  BuildSpec(request.spec);

  // Register the future BEFORE the RPC (callback may fire synchronously).
  auto future = lease_provider_.Get();
  GatewayServiceClient client(gateway_.rpc_client(), gateway_.channel_id());
  lease_call_ = client.AcquireSensingLease(
      request,
      [this](const maco_gateway_SensingLeaseResponse& resp, pw::Status st) {
        st.ok() ? lease_provider_.Resolve(resp) : lease_provider_.Resolve(st);
      },
      [this](pw::Status st) { lease_provider_.Resolve(st); });

  auto timed = co_await maco::async_util::RaceWithDeadline(
      std::move(future), time_provider_, kRpcDeadline);
  if (!timed.ok()) {
    PW_LOG_WARN("Gateway sensing RPC timed out; cancelling in-flight call");
    lease_call_.Cancel().IgnoreError();
    co_return timed.status();
  }
  auto& result = *timed;  // pw::Result<SensingLeaseResponse>
  if (!result.ok()) {
    co_return result.status();
  }
  lease_id_ = result->lease_id;
  have_lease_ = result->valid;
  ApplyState(result->valid, result->state);
  co_return pw::OkStatus();
}

pw::async2::Coro<pw::Status> GatewayMachineSensor::Renew(
    [[maybe_unused]] pw::async2::CoroContext cx) {
  maco_gateway_RenewSensingLeaseRequest request =
      maco_gateway_RenewSensingLeaseRequest_init_zero;
  std::snprintf(request.lease_id, sizeof(request.lease_id), "%s",
                lease_id_.c_str());

  auto future = lease_provider_.Get();
  GatewayServiceClient client(gateway_.rpc_client(), gateway_.channel_id());
  lease_call_ = client.RenewSensingLease(
      request,
      [this](const maco_gateway_SensingLeaseResponse& resp, pw::Status st) {
        st.ok() ? lease_provider_.Resolve(resp) : lease_provider_.Resolve(st);
      },
      [this](pw::Status st) { lease_provider_.Resolve(st); });

  auto timed = co_await maco::async_util::RaceWithDeadline(
      std::move(future), time_provider_, kRpcDeadline);
  if (!timed.ok()) {
    PW_LOG_WARN("Gateway sensing RPC timed out; cancelling in-flight call");
    lease_call_.Cancel().IgnoreError();
    co_return timed.status();
  }
  auto& result = *timed;
  if (!result.ok()) {
    co_return result.status();
  }
  ApplyState(result->valid, result->state);
  co_return pw::OkStatus();
}

pw::async2::Coro<pw::Status> GatewayMachineSensor::Run(
    pw::async2::CoroContext cx) {
  const auto poll_interval = std::chrono::seconds(config_.poll_interval_sec);
  while (true) {
    // Idle: wait for a session before touching the gateway/device at all.
    while (!session_active_.load(std::memory_order_relaxed)) {
      co_await time_provider_.WaitFor(kIdlePollInterval);
    }

    // Active session: acquire on first tick, renew thereafter. Any RPC failure
    // or invalid lease reports "not running" (unreachable => idle => the idle
    // timeout still auto-ends the session) and re-acquires next tick.
    have_lease_ = false;
    while (session_active_.load(std::memory_order_relaxed)) {
      if (!have_lease_) {
        (void)co_await Acquire(cx);
        if (!have_lease_) {
          NotifyRunning(false);
        }
      } else {
        pw::Status st = co_await Renew(cx);
        if (!st.ok()) {
          NotifyRunning(false);
          have_lease_ = false;  // force re-acquire (lease may be dead)
        }
      }
      co_await time_provider_.WaitFor(poll_interval);
    }

    // Session ended: stop reporting running and let the lease lapse — the
    // gateway drops the device connection after the TTL.
    NotifyRunning(false);
  }
  co_return pw::OkStatus();
}

}  // namespace maco::machine_control
