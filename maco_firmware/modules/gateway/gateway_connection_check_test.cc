// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "gateway/gateway_connection_check.h"

#include "gateway/gateway_service.pb.h"
#include "gateway/gateway_service.rpc.pb.h"
#include "maco_firmware/modules/app_state/system_monitor_backend.h"
#include "maco_firmware/modules/app_state/system_state.h"
#include "pw_allocator/testing.h"
#include "pw_async2/basic_dispatcher.h"
#include "pw_async2/simulated_time_provider.h"
#include "pw_rpc/nanopb/client_testing.h"
#include "pw_unit_test/framework.h"

namespace maco::gateway {
namespace {

using namespace std::chrono_literals;
using GatewayService = maco::gateway::pw_rpc::nanopb::GatewayService;

constexpr size_t kAllocatorSize = 4096;

// Trivial backend stub — Start() is a no-op.
class NullSystemMonitorBackend : public app_state::SystemMonitorBackend {
 public:
  void Start(app_state::SystemStateUpdater&,
             pw::async2::Dispatcher&) override {}
};

// Adapts NanopbClientTestContext to the GatewayClient interface so
// GatewayConnectionCheck can use it while tests inject responses.
class TestGatewayClient : public GatewayClient {
 public:
  TestGatewayClient(pw::rpc::Client& client, uint32_t channel_id)
      : client_(client), channel_id_(channel_id) {}

  void Start(pw::async2::Dispatcher&) override {}
  pw::rpc::Client& rpc_client() override { return client_; }
  uint32_t channel_id() const override { return channel_id_; }
  bool IsConnected() const override { return true; }
  pw::Status Connect() override { return pw::OkStatus(); }
  void Disconnect() override {}

 private:
  pw::rpc::Client& client_;
  uint32_t channel_id_;
};

class GatewayConnectionCheckTest : public ::testing::Test {
 protected:
  TestGatewayClient CreateGatewayClient() {
    return TestGatewayClient(rpc_ctx_.client(), rpc_ctx_.channel().id());
  }

  void SendPingResponse() {
    maco_gateway_PingResponse resp = maco_gateway_PingResponse_init_zero;
    rpc_ctx_.server().SendResponse<GatewayService::Ping>(resp, pw::OkStatus());
  }

  void SendPingError(pw::Status status) {
    rpc_ctx_.server().SendServerError<GatewayService::Ping>(status);
  }

  app_state::SystemStateSnapshot GetSnapshot() {
    app_state::SystemStateSnapshot snapshot;
    system_state_.GetSnapshot(snapshot);
    return snapshot;
  }

  void SetWifiConnected() {
    system_state_.SetWifiState(app_state::WifiState::kConnected);
  }

  // Advance simulated time past the next pending timer.
  // WaitFor(d) schedules at now+d+1tick, so AdvanceTime(d) alone won't fire.
  void AdvanceToNextTimer() {
    ASSERT_TRUE(time_provider_.AdvanceUntilNextExpiration());
  }

  NullSystemMonitorBackend monitor_backend_;
  app_state::SystemState system_state_{monitor_backend_};
  pw::rpc::NanopbClientTestContext<10, 512, 1024> rpc_ctx_;
  pw::async2::BasicDispatcher dispatcher_;
  pw::async2::SimulatedTimeProvider<pw::chrono::SystemClock> time_provider_;
  pw::allocator::test::AllocatorForTest<kAllocatorSize> test_allocator_;
};

// Phase 1: Coroutine waits for wifi before sending any pings.
TEST_F(GatewayConnectionCheckTest, WaitsForWifiBeforePing) {
  auto gw = CreateGatewayClient();
  GatewayConnectionCheck check(
      gw, system_state_, time_provider_, test_allocator_);
  check.Start(dispatcher_);

  // Coroutine starts, sees wifi disconnected, waits 1s.
  dispatcher_.RunUntilStalled();
  EXPECT_EQ(rpc_ctx_.output().total_packets(), 0u);

  // Advance past 1s timer — still disconnected, loops again.
  AdvanceToNextTimer();
  dispatcher_.RunUntilStalled();
  EXPECT_EQ(rpc_ctx_.output().total_packets(), 0u);

  // Connect wifi, advance past next timer — exits wifi loop, sends first ping.
  SetWifiConnected();
  AdvanceToNextTimer();
  dispatcher_.RunUntilStalled();
  EXPECT_EQ(rpc_ctx_.output().total_packets(), 1u);
}

// Phase 2: First ping succeeds — gateway connected, system ready.
TEST_F(GatewayConnectionCheckTest, StartupPingSuccess) {
  SetWifiConnected();
  auto gw = CreateGatewayClient();
  GatewayConnectionCheck check(
      gw, system_state_, time_provider_, test_allocator_);
  check.Start(dispatcher_);

  // Coroutine sees wifi connected, sends first ping immediately.
  dispatcher_.RunUntilStalled();
  EXPECT_EQ(rpc_ctx_.output().total_packets(), 1u);

  // Inject success response.
  SendPingResponse();
  dispatcher_.RunUntilStalled();

  auto snapshot = GetSnapshot();
  EXPECT_TRUE(snapshot.gateway_connected);
  EXPECT_EQ(snapshot.boot_state, app_state::BootState::kReady);
}

// Phase 2: First ping fails, retry succeeds.
TEST_F(GatewayConnectionCheckTest, StartupPingFailRetrySuccess) {
  SetWifiConnected();
  auto gw = CreateGatewayClient();
  GatewayConnectionCheck check(
      gw, system_state_, time_provider_, test_allocator_);
  check.Start(dispatcher_);

  // First ping sent.
  dispatcher_.RunUntilStalled();
  EXPECT_EQ(rpc_ctx_.output().total_packets(), 1u);

  // First ping fails.
  SendPingError(pw::Status::Unavailable());
  dispatcher_.RunUntilStalled();

  // Not yet ready — waiting 2s for retry.
  EXPECT_FALSE(GetSnapshot().gateway_connected);
  EXPECT_EQ(GetSnapshot().boot_state, app_state::BootState::kBooting);

  // Advance past 2s retry timer — retry ping sent.
  AdvanceToNextTimer();
  dispatcher_.RunUntilStalled();
  EXPECT_EQ(rpc_ctx_.output().total_packets(), 2u);

  // Retry succeeds.
  SendPingResponse();
  dispatcher_.RunUntilStalled();

  auto snapshot = GetSnapshot();
  EXPECT_TRUE(snapshot.gateway_connected);
  EXPECT_EQ(snapshot.boot_state, app_state::BootState::kReady);
}

// Phase 2: Both startup pings fail — system still becomes ready.
TEST_F(GatewayConnectionCheckTest, StartupBothPingsFail) {
  SetWifiConnected();
  auto gw = CreateGatewayClient();
  GatewayConnectionCheck check(
      gw, system_state_, time_provider_, test_allocator_);
  check.Start(dispatcher_);

  // First ping.
  dispatcher_.RunUntilStalled();
  SendPingError(pw::Status::Unavailable());
  dispatcher_.RunUntilStalled();

  // Retry after 2s.
  AdvanceToNextTimer();
  dispatcher_.RunUntilStalled();
  SendPingError(pw::Status::Unavailable());
  dispatcher_.RunUntilStalled();

  // System is ready but gateway not connected.
  auto snapshot = GetSnapshot();
  EXPECT_FALSE(snapshot.gateway_connected);
  EXPECT_EQ(snapshot.boot_state, app_state::BootState::kReady);
}

// Phase 3: Steady-state ping after startup completes.
TEST_F(GatewayConnectionCheckTest, SteadyStatePing) {
  SetWifiConnected();
  auto gw = CreateGatewayClient();
  GatewayConnectionCheck check(
      gw, system_state_, time_provider_, test_allocator_);
  check.Start(dispatcher_);

  // Complete startup with success.
  dispatcher_.RunUntilStalled();
  SendPingResponse();
  dispatcher_.RunUntilStalled();
  EXPECT_EQ(GetSnapshot().boot_state, app_state::BootState::kReady);

  auto packets_after_startup = rpc_ctx_.output().total_packets();

  // Advance past 15s timer — steady-state ping sent.
  AdvanceToNextTimer();
  dispatcher_.RunUntilStalled();
  EXPECT_EQ(rpc_ctx_.output().total_packets(), packets_after_startup + 1);

  // Inject success — still connected.
  SendPingResponse();
  dispatcher_.RunUntilStalled();
  EXPECT_TRUE(GetSnapshot().gateway_connected);
}

// Phase 3: Steady-state ping failure updates connectivity.
TEST_F(GatewayConnectionCheckTest, SteadyStatePingFailure) {
  SetWifiConnected();
  auto gw = CreateGatewayClient();
  GatewayConnectionCheck check(
      gw, system_state_, time_provider_, test_allocator_);
  check.Start(dispatcher_);

  // Complete startup with success.
  dispatcher_.RunUntilStalled();
  SendPingResponse();
  dispatcher_.RunUntilStalled();
  EXPECT_TRUE(GetSnapshot().gateway_connected);

  // Advance past 15s timer — steady-state ping.
  AdvanceToNextTimer();
  dispatcher_.RunUntilStalled();

  // This ping fails.
  SendPingError(pw::Status::Unavailable());
  dispatcher_.RunUntilStalled();
  EXPECT_FALSE(GetSnapshot().gateway_connected);
}

}  // namespace
}  // namespace maco::gateway
