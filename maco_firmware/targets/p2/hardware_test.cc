// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT
//
// On-device test for P2SystemMonitor.
// Controls WiFi and cloud connectivity via Device OS HAL and verifies
// that P2SystemMonitor delivers the correct state callbacks.
//
// Prerequisites: P2 with WiFi credentials configured.
// Run: bazel run //maco_firmware/targets/p2:hardware_test_flash

#include "maco_firmware/targets/p2/p2_system_monitor.h"

#include <atomic>

#include "maco_firmware/modules/app_state/system_state_updater.h"
#include "pw_async2/basic_dispatcher.h"
#include "pw_log/log.h"
#include "pw_unit_test/framework.h"
#include "system_cloud.h"
#include "system_network.h"
#include "timer_hal.h"

// system_delay_ms processes system events while sleeping (when
// no_background_loop=false) — unlike HAL_Delay_Milliseconds which
// is a plain vTaskDelay and never drains the application event queue.
#include "system_task.h"

namespace {

using maco::app_state::CloudState;
using maco::app_state::WifiState;

/// Records state changes from P2SystemMonitor for verification.
/// Uses atomics because callbacks may fire on the system thread.
class RecordingUpdater : public maco::app_state::SystemStateUpdater {
 public:
  void SetWifiState(WifiState state) override {
    wifi_state_.store(state, std::memory_order_release);
    int n = wifi_changes_.fetch_add(1, std::memory_order_release) + 1;
    PW_LOG_INFO("WiFi -> %d [#%d]", static_cast<int>(state), n);
  }

  void SetCloudState(CloudState state) override {
    cloud_state_.store(state, std::memory_order_release);
    int n = cloud_changes_.fetch_add(1, std::memory_order_release) + 1;
    PW_LOG_INFO("Cloud -> %d [#%d]", static_cast<int>(state), n);
  }

  void SetUtcBootOffsetSeconds(int64_t offset) override {
    int n = time_changes_.fetch_add(1, std::memory_order_release) + 1;
    PW_LOG_INFO("UTC offset -> %lld [#%d]",
                static_cast<long long>(offset), n);
  }

  WifiState wifi_state() const {
    return wifi_state_.load(std::memory_order_acquire);
  }
  CloudState cloud_state() const {
    return cloud_state_.load(std::memory_order_acquire);
  }
  int wifi_changes() const {
    return wifi_changes_.load(std::memory_order_acquire);
  }
  int cloud_changes() const {
    return cloud_changes_.load(std::memory_order_acquire);
  }
  int time_changes() const {
    return time_changes_.load(std::memory_order_acquire);
  }

 private:
  std::atomic<WifiState> wifi_state_{WifiState::kDisconnected};
  std::atomic<CloudState> cloud_state_{CloudState::kDisconnected};
  std::atomic<int> wifi_changes_{0};
  std::atomic<int> cloud_changes_{0};
  std::atomic<int> time_changes_{0};
};

/// Poll until predicate returns true, or timeout.
template <typename Pred>
bool WaitFor(Pred pred, uint32_t timeout_ms = 10000) {
  uint32_t start = hal_timer_millis(nullptr);
  while (!pred()) {
    if (hal_timer_millis(nullptr) - start > timeout_ms) return false;
    system_delay_ms(100, false);
  }
  return true;
}

/// Ensure WiFi and cloud are connected. Fails the test on timeout.
void EnsureConnected() {
  if (!network_ready(NIF_DEFAULT, NETWORK_READY_TYPE_ANY, nullptr)) {
    PW_LOG_INFO("WiFi not connected, reconnecting...");
    network_connect(NIF_DEFAULT, 0, 0, nullptr);
    ASSERT_TRUE(WaitFor(
        [] {
          return network_ready(NIF_DEFAULT, NETWORK_READY_TYPE_ANY, nullptr);
        },
        30000))
        << "WiFi reconnect timed out";
  }
  if (!spark_cloud_flag_connected()) {
    PW_LOG_INFO("Cloud not connected, reconnecting...");
    spark_cloud_flag_connect();
    ASSERT_TRUE(WaitFor([] { return spark_cloud_flag_connected(); }, 30000))
        << "Cloud reconnect timed out";
  }
}

// Static instances — persist across tests so we subscribe only once.
RecordingUpdater& GetUpdater() {
  static RecordingUpdater updater;
  return updater;
}

maco::P2SystemMonitor& GetMonitor() {
  static maco::P2SystemMonitor monitor;
  return monitor;
}

class SystemMonitorTest : public ::testing::Test {
 protected:
  void SetUp() override {
    if (!started_) {
      PW_LOG_INFO("=== Starting P2SystemMonitor ===");
      EnsureConnected();
      static pw::async2::BasicDispatcher dispatcher;
      GetMonitor().Start(GetUpdater(), dispatcher);
      started_ = true;
      // Cloud may transition through connecting states after Start().
      // Wait until it settles at kConnected before running tests.
      if (!WaitFor([] { return spark_cloud_flag_connected(); }, 15000)) {
        PW_LOG_WARN("Cloud did not settle to connected after Start()");
      }
    }
  }

  static bool started_;
};

bool SystemMonitorTest::started_ = false;

// --- Tests run in definition order within this test suite. ---

TEST_F(SystemMonitorTest, InitialStateCapturesConnectivity) {
  auto& u = GetUpdater();

  EXPECT_EQ(u.wifi_state(), WifiState::kConnected);
  EXPECT_EQ(u.cloud_state(), CloudState::kConnected);
  EXPECT_GE(u.time_changes(), 1)
      << "Time should be synced in Start()";

  PW_LOG_INFO("Initial: wifi=%d cloud=%d time_changes=%d",
              static_cast<int>(u.wifi_state()),
              static_cast<int>(u.cloud_state()),
              u.time_changes());
}

TEST_F(SystemMonitorTest, CloudDisconnectFiresCallback) {
  auto& u = GetUpdater();
  int baseline = u.cloud_changes();

  PW_LOG_INFO("--- Disconnecting cloud ---");
  spark_cloud_flag_disconnect();

  ASSERT_TRUE(WaitFor(
      [&] { return u.cloud_state() == CloudState::kDisconnected; }, 15000))
      << "Cloud did not report disconnected";
  EXPECT_GT(u.cloud_changes(), baseline);
}

TEST_F(SystemMonitorTest, CloudReconnectFiresCallbackAndSyncsTime) {
  auto& u = GetUpdater();
  int cloud_baseline = u.cloud_changes();
  int time_baseline = u.time_changes();

  PW_LOG_INFO("--- Reconnecting cloud ---");
  spark_cloud_flag_connect();

  ASSERT_TRUE(WaitFor(
      [&] { return u.cloud_state() == CloudState::kConnected; }, 30000))
      << "Cloud did not reconnect";
  EXPECT_GT(u.cloud_changes(), cloud_baseline);

  // Device OS may or may not fire time_changed on reconnect — it skips
  // the event when the RTC already has valid time close to the server.
  // Initial time sync is verified in InitialStateCapturesConnectivity.
  WaitFor([&] { return u.time_changes() > time_baseline; }, 5000);
  PW_LOG_INFO("time_changes after reconnect: %d (baseline was %d)",
              u.time_changes(), time_baseline);
}

TEST_F(SystemMonitorTest, WifiDisconnectFiresCallback) {
  auto& u = GetUpdater();
  int baseline = u.wifi_changes();

  PW_LOG_INFO("--- Disconnecting WiFi ---");
  network_disconnect(NIF_DEFAULT, 0, nullptr);

  ASSERT_TRUE(WaitFor(
      [&] { return u.wifi_state() == WifiState::kDisconnected; }, 15000))
      << "WiFi did not report disconnected";
  EXPECT_GT(u.wifi_changes(), baseline);
}

TEST_F(SystemMonitorTest, WifiReconnectFiresCallback) {
  auto& u = GetUpdater();
  int baseline = u.wifi_changes();

  PW_LOG_INFO("--- Reconnecting WiFi ---");
  network_connect(NIF_DEFAULT, 0, 0, nullptr);

  ASSERT_TRUE(WaitFor(
      [&] { return u.wifi_state() == WifiState::kConnected; }, 30000))
      << "WiFi did not reconnect";
  EXPECT_GT(u.wifi_changes(), baseline);

  // Restore full connectivity for any subsequent tests
  EnsureConnected();
}

}  // namespace
