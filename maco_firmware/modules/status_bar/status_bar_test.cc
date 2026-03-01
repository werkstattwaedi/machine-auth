// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/modules/status_bar/status_bar.h"

#include "gtest/gtest.h"
#include "maco_firmware/modules/app_state/system_monitor_backend.h"
#include "maco_firmware/modules/app_state/system_state.h"
#include "maco_firmware/modules/display/testing/screenshot_test_harness.h"

namespace maco::status_bar {
namespace {

using display::testing::ScreenshotTestHarness;

// Trivial backend stub — Start() is a no-op.
class NullSystemMonitorBackend : public app_state::SystemMonitorBackend {
 public:
  void Start(app_state::SystemStateUpdater&,
             pw::async2::Dispatcher&) override {}
};

class StatusBarTest : public ::testing::Test {
 protected:
  void SetUp() override {
    ASSERT_EQ(harness_.Init(), pw::OkStatus());

    bar_ = std::make_unique<StatusBar>(system_state_);
    ASSERT_EQ(bar_->Init(), pw::OkStatus());
    bar_->SetVisible(true);

    // Dark background so white icons are visible
    lv_obj_set_style_bg_color(lv_screen_active(), lv_color_hex(0x303030),
                              LV_PART_MAIN);
    lv_obj_set_style_bg_opa(lv_screen_active(), LV_OPA_COVER, LV_PART_MAIN);
    bar_->SetBackgroundColor(0x303030);
  }

  NullSystemMonitorBackend monitor_backend_;
  app_state::SystemState system_state_{monitor_backend_};
  ScreenshotTestHarness harness_;
  std::unique_ptr<StatusBar> bar_;
};

// Default state: gateway disconnected, wifi disconnected, no time.
TEST_F(StatusBarTest, AllDisconnected) {
  bar_->Update();
  harness_.RenderFrame();

  EXPECT_TRUE(harness_.CompareToGolden(
      "maco_firmware/modules/status_bar/testdata/all_disconnected.png",
      "/tmp/status_bar_all_disconnected_diff.png"));
}

// Gateway + wifi connected (no time offset → shows --:--)
TEST_F(StatusBarTest, AllConnected) {
  system_state_.SetGatewayConnected(true);
  system_state_.SetWifiState(app_state::WifiState::kConnected);

  bar_->Update();
  harness_.RenderFrame();

  EXPECT_TRUE(harness_.CompareToGolden(
      "maco_firmware/modules/status_bar/testdata/all_connected.png",
      "/tmp/status_bar_all_connected_diff.png"));
}

// Wifi connected but gateway disconnected.
TEST_F(StatusBarTest, GatewayDisconnected) {
  system_state_.SetWifiState(app_state::WifiState::kConnected);

  bar_->Update();
  harness_.RenderFrame();

  EXPECT_TRUE(harness_.CompareToGolden(
      "maco_firmware/modules/status_bar/testdata/gateway_disconnected.png",
      "/tmp/status_bar_gateway_disconnected_diff.png"));
}

}  // namespace
}  // namespace maco::status_bar
