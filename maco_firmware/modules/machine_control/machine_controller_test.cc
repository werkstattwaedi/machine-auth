// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/modules/machine_control/machine_controller.h"

#include "gtest/gtest.h"
#include "maco_firmware/modules/machine_control/mock/mock_machine_sensor.h"
#include "maco_firmware/modules/machine_control/mock/mock_machine_toggle.h"
#include "pw_allocator/testing.h"
#include "pw_async2/basic_dispatcher.h"
#include "pw_assert/check.h"
#include "pw_async2/simulated_time_provider.h"

namespace maco::machine_control {
namespace {

using namespace std::chrono_literals;

class MachineControllerTest : public ::testing::Test {
 protected:
  void SetUp() override {
    PW_CHECK_OK(toggle_.Init());
    controller_.emplace(toggle_, time_provider_, test_allocator_);
  }

  // Advance to the next timer expiration and run the dispatcher so the
  // controller's Run() coroutine processes any pending commands.
  void Tick() {
    time_provider_.AdvanceUntilNextExpiration();
    dispatcher_.RunUntilStalled();
  }

  // Start the controller coroutine and run until it stalls (waiting on timer).
  void StartController() {
    controller_->Start(dispatcher_);
    dispatcher_.RunUntilStalled();
  }

  pw::allocator::test::AllocatorForTest<4096> test_allocator_;
  pw::async2::SimulatedTimeProvider<pw::chrono::SystemClock> time_provider_;
  pw::async2::BasicDispatcher dispatcher_;
  MockMachineToggle toggle_;
  std::optional<MachineController> controller_;
};

// --- OnMachineRunning (sensor callback) ---

TEST_F(MachineControllerTest, InitiallyNotRunning) {
  EXPECT_FALSE(controller_->IsMachineRunning());
}

TEST_F(MachineControllerTest, OnMachineRunningUpdatesState) {
  controller_->OnMachineRunning(true);
  EXPECT_TRUE(controller_->IsMachineRunning());

  controller_->OnMachineRunning(false);
  EXPECT_FALSE(controller_->IsMachineRunning());
}

TEST_F(MachineControllerTest, OnMachineRunningIdempotent) {
  controller_->OnMachineRunning(true);
  controller_->OnMachineRunning(true);
  EXPECT_TRUE(controller_->IsMachineRunning());
}

// --- Session observer: toggle enable/disable ---

TEST_F(MachineControllerTest, SessionStartEnablesToggle) {
  StartController();

  app_state::SessionInfo session;
  session.user_label = "TestUser";
  controller_->OnSessionStarted(session);

  Tick();

  EXPECT_TRUE(toggle_.IsEnabled());
  EXPECT_EQ(toggle_.toggle_count(), 1u);
}

TEST_F(MachineControllerTest, SessionEndDisablesToggle) {
  StartController();

  app_state::SessionInfo session;
  session.user_label = "TestUser";
  controller_->OnSessionStarted(session);
  Tick();

  app_state::MachineUsage usage;
  usage.reason = app_state::CheckoutReason::kSelfCheckout;
  controller_->OnSessionEnded(session, usage);
  Tick();

  EXPECT_FALSE(toggle_.IsEnabled());
  EXPECT_EQ(toggle_.toggle_count(), 2u);
}

TEST_F(MachineControllerTest, ToggleErrorDoesNotCrash) {
  StartController();

  toggle_.SetNextError(pw::Status::Internal());

  app_state::SessionInfo session;
  session.user_label = "TestUser";
  controller_->OnSessionStarted(session);
  Tick();

  // Toggle should not have changed state because of the injected error.
  EXPECT_FALSE(toggle_.IsEnabled());
}

// --- Sensor + Controller wiring ---

TEST_F(MachineControllerTest, SensorCallbackUpdatesMachineRunning) {
  MockMachineSensor sensor;
  sensor.SetCallback(
      [this](bool running) { controller_->OnMachineRunning(running); });

  StartController();
  sensor.Start(dispatcher_);

  // Initial callback fires false
  EXPECT_FALSE(controller_->IsMachineRunning());

  sensor.SetRunning(true);
  EXPECT_TRUE(controller_->IsMachineRunning());

  sensor.SetRunning(false);
  EXPECT_FALSE(controller_->IsMachineRunning());
}

TEST_F(MachineControllerTest, IsToggleEnabledReflectsState) {
  StartController();
  EXPECT_FALSE(controller_->IsToggleEnabled());

  app_state::SessionInfo session;
  session.user_label = "TestUser";
  controller_->OnSessionStarted(session);
  Tick();

  EXPECT_TRUE(controller_->IsToggleEnabled());
}

}  // namespace
}  // namespace maco::machine_control
