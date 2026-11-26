// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/modules/machine_control/gateway_machine_sensor.h"

#include <cstdio>
#include <optional>

#include "async_util/status_coro_task.h"
#include "maco_firmware/modules/machine_control/gateway_machine_toggle.h"

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
                         bool renew, bool active = false) {
    maco_gateway_SensingLeaseResponse resp =
        maco_gateway_SensingLeaseResponse_init_zero;
    resp.valid = valid;
    resp.state = state;
    resp.active = active;
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

  // A CNC-style config: gantry switched + metered, spindle metered.
  void UseShellyConfig() {
    config_ = {};
    config_.kind = config::SensingKind::kShellyPower;
    config_.idle_timeout_sec = 1800;
    config::ShellyEndpointConfig gantry;
    gantry.host = "gantry.test:8101";
    gantry.component = "switch:0";
    config_.shelly.actuator = gantry;
    config::PowerSignalConfig spindle;
    spindle.source.host = "spindle.test";
    spindle.source.component = "pm1:0";
    spindle.role = config::PowerSignalRole::kBillable;
    spindle.threshold_w = 40;
    spindle.rise_sec = 3;
    spindle.fall_sec = 10;
    config_.shelly.signals.push_back(spindle);
    config::PowerSignalConfig motion;
    motion.source = gantry;
    motion.role = config::PowerSignalRole::kActivity;
    motion.threshold_w = 85;
    config_.shelly.signals.push_back(motion);
  }

  // Latest running state pushed via the sensor callback.
  app_state::MachineActivity last_activity_ = app_state::MachineActivity::kIdle;
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

// --- Shelly power (ADR-0054) ---

TEST_F(GatewayMachineSensorTest, BuildsShellySpec) {
  UseShellyConfig();
  maco_gateway_SensingSpec spec;
  BuildSensingSpec(config_, spec);
  ASSERT_EQ(spec.which_backend, maco_gateway_SensingSpec_shelly_power_tag);
  const auto& sp = spec.backend.shelly_power;
  EXPECT_TRUE(sp.has_actuator);
  EXPECT_STREQ(sp.actuator.host, "gantry.test:8101");
  EXPECT_STREQ(sp.actuator.component, "switch:0");
  ASSERT_EQ(sp.signals_count, 2u);
  EXPECT_STREQ(sp.signals[0].source.host, "spindle.test");
  EXPECT_EQ(sp.signals[0].role,
            maco_gateway_PowerSignalRole_POWER_SIGNAL_ROLE_BILLABLE);
  EXPECT_EQ(sp.signals[0].threshold_w, 40u);
  EXPECT_EQ(sp.signals[1].role,
            maco_gateway_PowerSignalRole_POWER_SIGNAL_ROLE_ACTIVITY);
  // The gateway's backstop uses the machine's own idle time.
  EXPECT_EQ(sp.orphan_off_after_sec, 1800u);
}

class ShellySensorTest : public GatewayMachineSensorTest {
 protected:
  void StartSession(GatewayMachineSensor& sensor) {
    sensor.SetCallback([this](bool r) { last_running_ = r; });
    sensor.SetActivityCallback(
        [this](app_state::MachineActivity a) { last_activity_ = a; });
    sensor.Start(dispatcher_);
    dispatcher_.RunUntilStalled();
    sensor.OnSessionStarted(app_state::SessionInfo{});
    AdvanceToNextTimer();
    dispatcher_.RunUntilStalled();
  }
};

TEST_F(ShellySensorTest, ActivityWithoutBillableUse) {
  UseShellyConfig();
  auto gw = CreateGatewayClient();
  GatewayMachineSensor sensor(gw, config_, time_provider_, test_allocator_);
  StartSession(sensor);
  SendLeaseResponse(true, maco_gateway_SensingState_SENSING_STATE_IDLE,
                    /*renew=*/false, /*active=*/true);
  dispatcher_.RunUntilStalled();
  EXPECT_FALSE(last_running_);
  EXPECT_EQ(last_activity_, app_state::MachineActivity::kActive);
}

TEST_F(ShellySensorTest, UnreachableIsUnknownWhenGatewaySwitches) {
  UseShellyConfig();
  auto gw = CreateGatewayClient();
  GatewayMachineSensor sensor(gw, config_, time_provider_, test_allocator_);
  StartSession(sensor);
  SendLeaseResponse(true, maco_gateway_SensingState_SENSING_STATE_UNREACHABLE,
                    false);
  dispatcher_.RunUntilStalled();
  EXPECT_FALSE(last_running_);
  EXPECT_EQ(last_activity_, app_state::MachineActivity::kUnknown);
}

TEST_F(ShellySensorTest, UnreachableIsIdleWhenRelaySwitches) {
  // The laser: the relay can cut power, so unknown keeps counting as idle.
  auto gw = CreateGatewayClient();
  GatewayMachineSensor sensor(gw, config_, time_provider_, test_allocator_);
  StartSession(sensor);
  SendLeaseResponse(true, maco_gateway_SensingState_SENSING_STATE_UNREACHABLE,
                    false);
  dispatcher_.RunUntilStalled();
  EXPECT_EQ(last_activity_, app_state::MachineActivity::kIdle);
}

TEST_F(ShellySensorTest, RunningWithoutActiveFlagIsActive) {
  // A gateway from before ADR-0054 never sets `active`.
  auto gw = CreateGatewayClient();
  GatewayMachineSensor sensor(gw, config_, time_provider_, test_allocator_);
  StartSession(sensor);
  SendLeaseResponse(true, maco_gateway_SensingState_SENSING_STATE_RUNNING,
                    false, /*active=*/false);
  dispatcher_.RunUntilStalled();
  EXPECT_TRUE(last_running_);
  EXPECT_EQ(last_activity_, app_state::MachineActivity::kActive);
}

// --- GatewayMachineToggle ---

pw::async2::Coro<pw::Status> RunToggle(pw::async2::CoroContext cx,
                                       GatewayMachineToggle& toggle, bool on,
                                       std::optional<pw::Status>& out) {
  out = on ? co_await toggle.Enable(cx) : co_await toggle.Disable(cx);
  co_return pw::OkStatus();
}

class GatewayMachineToggleTest : public GatewayMachineSensorTest {
 protected:
  void SendSetPower(bool ok, bool reachable) {
    maco_gateway_SetPowerResponse resp = maco_gateway_SetPowerResponse_init_zero;
    resp.ok = ok;
    resp.reachable = reachable;
    rpc_ctx_.server().SendResponse<GatewayService::SetPower>(resp,
                                                             pw::OkStatus());
  }
};

TEST_F(GatewayMachineToggleTest, EnableConfirmedByDevice) {
  UseShellyConfig();
  auto gw = CreateGatewayClient();
  GatewayMachineToggle toggle(gw, config_, time_provider_);
  // Unknown at boot: assumed on, so an involuntary reset resumes the session.
  EXPECT_TRUE(toggle.IsEnabled());

  std::optional<pw::Status> result;
  pw::async2::CoroContext cx(test_allocator_);
  maco::async_util::StatusCoroTask task(RunToggle(cx, toggle, false, result),
                                        [](pw::Status) {});
  dispatcher_.Post(task);
  dispatcher_.RunUntilStalled();
  ASSERT_EQ(rpc_ctx_.output().total_packets(), 1u);
  SendSetPower(/*ok=*/true, /*reachable=*/true);
  dispatcher_.RunUntilStalled();
  ASSERT_TRUE(result.has_value());
  EXPECT_EQ(*result, pw::OkStatus());
  EXPECT_FALSE(toggle.IsEnabled());
}

TEST_F(GatewayMachineToggleTest, EnableFailsWhenUnreachable) {
  UseShellyConfig();
  auto gw = CreateGatewayClient();
  GatewayMachineToggle toggle(gw, config_, time_provider_);

  std::optional<pw::Status> result;
  pw::async2::CoroContext cx(test_allocator_);
  maco::async_util::StatusCoroTask task(RunToggle(cx, toggle, true, result),
                                        [](pw::Status) {});
  dispatcher_.Post(task);
  dispatcher_.RunUntilStalled();
  SendSetPower(false, /*reachable=*/false);
  dispatcher_.RunUntilStalled();
  ASSERT_FALSE(result.has_value());  // waiting to retry
  AdvanceToNextTimer();
  dispatcher_.RunUntilStalled();
  EXPECT_EQ(rpc_ctx_.output().total_packets(), 2u);  // the retry
  SendSetPower(false, false);
  dispatcher_.RunUntilStalled();
  ASSERT_TRUE(result.has_value());
  EXPECT_EQ(*result, pw::Status::Unavailable());
}

}  // namespace
}  // namespace maco::machine_control
