// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/modules/terminal_ui/screens/main_screen.h"

#include "gtest/gtest.h"
#include "maco_firmware/modules/display/testing/screenshot_test_harness.h"

namespace maco::terminal_ui {
namespace {

using display::testing::ScreenshotTestHarness;

// Track actions emitted by the screen
UiAction last_action = UiAction::kNone;
void TestActionCallback(UiAction action) { last_action = action; }

class MainScreenTest : public ::testing::Test {
 protected:
  void SetUp() override {
    last_action = UiAction::kNone;
    ASSERT_EQ(harness_.Init(), pw::OkStatus());

    screen_ = std::make_unique<MainScreen>(TestActionCallback);
    ASSERT_EQ(harness_.ActivateScreen(*screen_), pw::OkStatus());
  }

  void TearDown() override {
    if (screen_) {
      screen_->OnDeactivate();
    }
  }

  ScreenshotTestHarness harness_;
  std::unique_ptr<MainScreen> screen_;
};

TEST_F(MainScreenTest, Idle) {
  app_state::AppStateSnapshot snapshot;
  screen_->OnUpdate(snapshot);
  harness_.RenderFrame();

  EXPECT_TRUE(harness_.CompareToGolden(
      "maco_firmware/modules/terminal_ui/testdata/main_idle.png",
      "/tmp/main_idle_diff.png"));
}

TEST_F(MainScreenTest, IdleButtonConfig) {
  auto config = screen_->GetButtonConfig();
  EXPECT_TRUE(config.cancel.label.empty());
  EXPECT_EQ(config.ok.label, "...");
}

}  // namespace
}  // namespace maco::terminal_ui
