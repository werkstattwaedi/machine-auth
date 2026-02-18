// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/modules/terminal_ui/screens/splash_screen.h"

#include "gtest/gtest.h"
#include "maco_firmware/modules/display/testing/screenshot_test_harness.h"

namespace maco::terminal_ui {
namespace {

using display::testing::ScreenshotTestHarness;

class SplashScreenTest : public ::testing::Test {
 protected:
  void SetUp() override {
    ASSERT_EQ(harness_.Init(), pw::OkStatus());

    screen_ = std::make_unique<SplashScreen>();
    ASSERT_EQ(harness_.ActivateScreen(*screen_), pw::OkStatus());
  }

  void TearDown() override {
    if (screen_) {
      screen_->OnDeactivate();
    }
  }

  ScreenshotTestHarness harness_;
  std::unique_ptr<SplashScreen> screen_;
};

TEST_F(SplashScreenTest, Render) {
  harness_.RenderFrame();

  EXPECT_TRUE(harness_.CompareToGolden(
      "maco_firmware/modules/terminal_ui/testdata/splash.png",
      "/tmp/splash_diff.png"));
}

}  // namespace
}  // namespace maco::terminal_ui
