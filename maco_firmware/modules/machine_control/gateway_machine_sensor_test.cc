// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/modules/machine_control/gateway_machine_sensor.h"

#include <cstdio>

#include "device_config/device_config.h"
#include "gateway/gateway_client.h"
#include "gateway/gateway_service.pb.h"
#include "gateway/gateway_service.rpc.pb.h"
#include "pw_allocator/testing.h"
#include "pw_async2/basic_dispatcher.h"
#include "pw_async2/simulated_time_provider.h"
#include "pw_rpc/nanopb/client_testing.h"
#include "pw_unit_test/framework.h"

namespace maco::machine_control {
namespace {

using namespace std::chrono_literals;
using GatewayService = maco::gateway::pw_rpc::nanopb::GatewayService;

constexpr size_t kAllocatorSize = 4096;

// Adapts NanopbClientTestContext to the GatewayClient interface.
class TestGatewayClient : public gateway::GatewayClient {
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

class GatewayMachineSensorTest : public ::testing::Test {
 protected:
  GatewayMachineSensorTest() {
    config_.kind = config::SensingKind::kXToolLaser;
    config_.host = "laser.test";
    config_.poll_interval_sec = 3;
  }

  config::GatewaySensingConfig config_;

  TestGatewayClient CreateGatewayClient() {
    return TestGatewayClient(rpc_ctx_.client(), rpc_ctx_.channel().id());
  }

  void SendLeaseResponse(bool valid, maco_gateway_SensingState state,
                         bool renew) {
    maco_gateway_SensingLeaseResponse resp =
        maco_gateway_SensingLeaseResponse_init_zero;
    resp.valid = valid;
    resp.state = state;
    std::snprintf(resp.lease_id, sizeof(resp.lease_id), "test-lease");
    if (renew) {
      rpc_ctx_.server().SendResponse<GatewayService::RenewSensingLease>(
          resp, pw::OkStatus());
    } else {
      rpc_ctx_.server().SendResponse<GatewayService::AcquireSensingLease>(
          resp, pw::OkStatus());
    }
  }

  void AdvanceToNextTimer() {
    ASSERT_TRUE(time_provider_.AdvanceUntilNextExpiration());
  }

  pw::rpc::NanopbClientTestContext<10, 512, 1024> rpc_ctx_;
  pw::async2::BasicDispatcher dispatcher_;
  pw::async2::SimulatedTimeProvider<pw::chrono::SystemClock> time_provider_;
  pw::allocator::test::AllocatorForTest<kAllocatorSize> test_allocator_;

  // Latest running state pushed via the sensor callback.
  bool last_running_ = false;
  int callback_count_ = 0;
};

// No session: the sensor reports "not running" and never touches the gateway.
TEST_F(GatewayMachineSensorTest, IdleWithoutSessionDoesNotPoll) {
  auto gw = CreateGatewayClient();
  GatewayMachineSensor sensor(gw, config_, time_provider_, test_allocator_);
  sensor.SetCallback([this](bool r) { last_running_ = r; ++callback_count_; });
  sensor.Start(dispatcher_);

  dispatcher_.RunUntilStalled();
  EXPECT_FALSE(last_running_);
  EXPECT_EQ(rpc_ctx_.output().total_packets(), 0u);  // no lease without session
}

// Session start → acquire → RUNNING state is reported as running=true.
TEST_F(GatewayMachineSensorTest, AcquiresOnSessionAndReportsRunning) {
  auto gw = CreateGatewayClient();
  GatewayMachineSensor sensor(gw, config_, time_provider_, test_allocator_);
  sensor.SetCallback([this](bool r) { last_running_ = r; ++callback_count_; });
  sensor.Start(dispatcher_);
  dispatcher_.RunUntilStalled();

  app_state::SessionInfo session{};
  sensor.OnSessionStarted(session);
  AdvanceToNextTimer();  // fire the idle-poll wait
  dispatcher_.RunUntilStalled();
  EXPECT_EQ(rpc_ctx_.output().total_packets(), 1u);  // AcquireSensingLease sent

  SendLeaseResponse(/*valid=*/true,
                    maco_gateway_SensingState_SENSING_STATE_RUNNING,
                    /*renew=*/false);
  dispatcher_.RunUntilStalled();
  EXPECT_TRUE(last_running_);
}

// After acquiring, a renew returning IDLE flips running back to false.
TEST_F(GatewayMachineSensorTest, RenewReportsIdle) {
  auto gw = CreateGatewayClient();
  GatewayMachineSensor sensor(gw, config_, time_provider_, test_allocator_);
  sensor.SetCallback([this](bool r) { last_running_ = r; ++callback_count_; });
  sensor.Start(dispatcher_);
  dispatcher_.RunUntilStalled();

  sensor.OnSessionStarted(app_state::SessionInfo{});
  AdvanceToNextTimer();
  dispatcher_.RunUntilStalled();
  SendLeaseResponse(true, maco_gateway_SensingState_SENSING_STATE_RUNNING, false);
  dispatcher_.RunUntilStalled();
  ASSERT_TRUE(last_running_);

  // Advance past the poll interval → a renew goes out.
  AdvanceToNextTimer();
  dispatcher_.RunUntilStalled();
  SendLeaseResponse(true, maco_gateway_SensingState_SENSING_STATE_IDLE, true);
  dispatcher_.RunUntilStalled();
  EXPECT_FALSE(last_running_);
}

// An invalid lease on renew forces a re-acquire on the next tick.
TEST_F(GatewayMachineSensorTest, InvalidLeaseReacquires) {
  auto gw = CreateGatewayClient();
  GatewayMachineSensor sensor(gw, config_, time_provider_, test_allocator_);
  sensor.SetCallback([this](bool r) { last_running_ = r; ++callback_count_; });
  sensor.Start(dispatcher_);
  dispatcher_.RunUntilStalled();

  sensor.OnSessionStarted(app_state::SessionInfo{});
  AdvanceToNextTimer();
  dispatcher_.RunUntilStalled();
  SendLeaseResponse(true, maco_gateway_SensingState_SENSING_STATE_RUNNING, false);
  dispatcher_.RunUntilStalled();

  // Renew returns invalid → not running, lease dropped.
  AdvanceToNextTimer();
  dispatcher_.RunUntilStalled();
  SendLeaseResponse(false, maco_gateway_SensingState_SENSING_STATE_UNSPECIFIED,
                    true);
  dispatcher_.RunUntilStalled();
  EXPECT_FALSE(last_running_);

  // Next tick re-acquires (a fresh AcquireSensingLease packet).
  const auto before = rpc_ctx_.output().total_packets();
  AdvanceToNextTimer();
  dispatcher_.RunUntilStalled();
  EXPECT_EQ(rpc_ctx_.output().total_packets(), before + 1);
}

// Session end reports not-running and stops polling (lease lapses).
TEST_F(GatewayMachineSensorTest, SessionEndStopsPolling) {
  auto gw = CreateGatewayClient();
  GatewayMachineSensor sensor(gw, config_, time_provider_, test_allocator_);
  sensor.SetCallback([this](bool r) { last_running_ = r; ++callback_count_; });
  sensor.Start(dispatcher_);
  dispatcher_.RunUntilStalled();

  sensor.OnSessionStarted(app_state::SessionInfo{});
  AdvanceToNextTimer();
  dispatcher_.RunUntilStalled();
  SendLeaseResponse(true, maco_gateway_SensingState_SENSING_STATE_RUNNING, false);
  dispatcher_.RunUntilStalled();
  ASSERT_TRUE(last_running_);

  sensor.OnSessionEnded(app_state::SessionInfo{}, app_state::MachineUsage{});
  AdvanceToNextTimer();  // fire the poll wait; loop exits
  dispatcher_.RunUntilStalled();
  EXPECT_FALSE(last_running_);

  // No further packets go out while idle between sessions.
  const auto after_end = rpc_ctx_.output().total_packets();
  AdvanceToNextTimer();
  dispatcher_.RunUntilStalled();
  EXPECT_EQ(rpc_ctx_.output().total_packets(), after_end);
}

}  // namespace
}  // namespace maco::machine_control
