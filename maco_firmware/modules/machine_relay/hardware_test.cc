// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT
//
// On-device hardware test for latching machine relay.
// Self-contained test that creates hardware instances directly.
//
// Test categories:
// - Hardware Validation: Initialization, state reading
// - Toggle Operations: Enable, disable, verification
// - Idempotent Operations: Double enable/disable should be no-ops
//
// WARNING: These tests will physically toggle the relay. Ensure the machine
// is disconnected or use appropriate safety precautions before running.

// Must define PW_LOG_MODULE_NAME before including any headers that use pw_log
#define PW_LOG_MODULE_NAME "relay_test"

// Pigweed headers first (avoid macro pollution from HAL)
#include "maco_firmware/modules/machine_relay/latching_machine_relay.h"
#include "pw_allocator/testing.h"
#include "pw_async2/basic_dispatcher.h"
#include "pw_async2/coro.h"
#include "pw_async2/system_time_provider.h"
#include "pw_log/log.h"
#include "pw_unit_test/framework.h"

// HAL headers after Pigweed
#include "delay_hal.h"
#include "pinmap_hal.h"

namespace {
using namespace std::chrono_literals;

// Pin for machine relay control (same as production system.cc)
constexpr hal_pin_t kPinMachineRelay = A1;

// Allocator for coroutine contexts
pw::allocator::test::AllocatorForTest<1024> test_allocator;

// Get singleton relay instance
maco::machine_relay::LatchingMachineRelay& GetRelay() {
  static maco::machine_relay::LatchingMachineRelay relay(
      kPinMachineRelay, pw::async2::GetSystemTimeProvider());
  return relay;
}

// Wrapper task to run a coroutine with arbitrary return type
template <typename T>
class CoroRunnerTask : public pw::async2::Task {
 public:
  explicit CoroRunnerTask(pw::async2::Coro<T>&& coro)
      : coro_(std::move(coro)) {}

  bool is_complete() const { return result_.has_value(); }
  T& result() { return *result_; }

 private:
  pw::async2::Poll<> DoPend(pw::async2::Context& cx) override {
    auto poll = coro_.Pend(cx);
    if (poll.IsPending()) {
      return pw::async2::Pending();
    }
    result_.emplace(std::move(*poll));
    return pw::async2::Ready();
  }

  pw::async2::Coro<T> coro_;
  std::optional<T> result_;
};

// Helper to run a coroutine synchronously using a dispatcher
template <typename T>
T RunCoro(pw::async2::Coro<T> coro) {
  pw::async2::BasicDispatcher dispatcher;
  CoroRunnerTask<T> task(std::move(coro));

  dispatcher.Post(task);

  // Run until the coroutine completes
  while (!task.is_complete()) {
    dispatcher.RunUntilStalled();
    HAL_Delay_Milliseconds(1);
  }

  return std::move(task.result());
}

class MachineRelayHardwareTest : public ::testing::Test {
 protected:
  void SetUp() override {
    PW_LOG_INFO("=== MachineRelayHardwareTest::SetUp ===");
  }

  void TearDown() override {
    PW_LOG_INFO("=== MachineRelayHardwareTest::TearDown ===");
    // Ensure relay is disabled after each test for safety
    auto& relay = GetRelay();
    if (relay.IsEnabled()) {
      PW_LOG_INFO("Disabling relay in TearDown");
      (void)RunCoro(relay.Disable(coro_cx_));
    }
  }

  pw::async2::CoroContext coro_cx_{test_allocator};
};

// Test that Init() succeeds and reads current state
TEST_F(MachineRelayHardwareTest, InitSucceeds) {
  auto& relay = GetRelay();

  auto status = relay.Init();
  EXPECT_TRUE(status.ok()) << "Init failed: " << static_cast<int>(status.code());

  PW_LOG_INFO("Relay initialized, current state: %s",
              relay.IsEnabled() ? "enabled" : "disabled");
}

// Test basic enable operation
// WARNING: This will physically toggle the relay!
TEST_F(MachineRelayHardwareTest, EnableSucceeds) {
  auto& relay = GetRelay();
  ASSERT_TRUE(relay.Init().ok());

  // Ensure we start disabled
  if (relay.IsEnabled()) {
    auto status = RunCoro(relay.Disable(coro_cx_));
    ASSERT_TRUE(status.ok()) << "Pre-disable failed";
  }

  PW_LOG_INFO("Enabling relay...");
  auto status = RunCoro(relay.Enable(coro_cx_));
  EXPECT_TRUE(status.ok()) << "Enable failed: " << static_cast<int>(status.code());
  EXPECT_TRUE(relay.IsEnabled());

  PW_LOG_INFO("Relay enabled successfully");
}

// Test basic disable operation
// WARNING: This will physically toggle the relay!
TEST_F(MachineRelayHardwareTest, DisableSucceeds) {
  auto& relay = GetRelay();
  ASSERT_TRUE(relay.Init().ok());

  // First enable the relay
  if (!relay.IsEnabled()) {
    auto status = RunCoro(relay.Enable(coro_cx_));
    ASSERT_TRUE(status.ok()) << "Pre-enable failed";
  }

  PW_LOG_INFO("Disabling relay...");
  auto status = RunCoro(relay.Disable(coro_cx_));
  EXPECT_TRUE(status.ok()) << "Disable failed: " << static_cast<int>(status.code());
  EXPECT_FALSE(relay.IsEnabled());

  PW_LOG_INFO("Relay disabled successfully");
}

// Test that enabling an already-enabled relay is a no-op
TEST_F(MachineRelayHardwareTest, DoubleEnableIsNoop) {
  auto& relay = GetRelay();
  ASSERT_TRUE(relay.Init().ok());

  // Ensure enabled
  auto status = RunCoro(relay.Enable(coro_cx_));
  ASSERT_TRUE(status.ok());
  ASSERT_TRUE(relay.IsEnabled());

  // Enable again - should succeed immediately without toggling
  PW_LOG_INFO("Double-enabling (should be instant no-op)...");
  status = RunCoro(relay.Enable(coro_cx_));
  EXPECT_TRUE(status.ok());
  EXPECT_TRUE(relay.IsEnabled());
}

// Test that disabling an already-disabled relay is a no-op
TEST_F(MachineRelayHardwareTest, DoubleDisableIsNoop) {
  auto& relay = GetRelay();
  ASSERT_TRUE(relay.Init().ok());

  // Ensure disabled
  auto status = RunCoro(relay.Disable(coro_cx_));
  ASSERT_TRUE(status.ok());
  ASSERT_FALSE(relay.IsEnabled());

  // Disable again - should succeed immediately without toggling
  PW_LOG_INFO("Double-disabling (should be instant no-op)...");
  status = RunCoro(relay.Disable(coro_cx_));
  EXPECT_TRUE(status.ok());
  EXPECT_FALSE(relay.IsEnabled());
}

// Test full enable/disable cycle
// WARNING: This will physically toggle the relay twice!
TEST_F(MachineRelayHardwareTest, FullCycle) {
  auto& relay = GetRelay();
  ASSERT_TRUE(relay.Init().ok());

  // Start disabled
  if (relay.IsEnabled()) {
    auto status = RunCoro(relay.Disable(coro_cx_));
    ASSERT_TRUE(status.ok());
  }
  ASSERT_FALSE(relay.IsEnabled());

  PW_LOG_INFO("Starting full enable/disable cycle...");

  // Enable
  auto status = RunCoro(relay.Enable(coro_cx_));
  ASSERT_TRUE(status.ok());
  ASSERT_TRUE(relay.IsEnabled());
  PW_LOG_INFO("Enabled");

  // Disable
  status = RunCoro(relay.Disable(coro_cx_));
  ASSERT_TRUE(status.ok());
  ASSERT_FALSE(relay.IsEnabled());
  PW_LOG_INFO("Disabled");

  PW_LOG_INFO("Full cycle complete");
}

}  // namespace
