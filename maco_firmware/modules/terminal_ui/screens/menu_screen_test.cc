// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/modules/terminal_ui/screens/menu_screen.h"

#include "gtest/gtest.h"
#include "maco_firmware/modules/display/testing/screenshot_test_harness.h"
#include "maco_firmware/modules/terminal_ui/theme.h"

namespace maco::terminal_ui {
namespace {

using display::testing::ScreenshotTestHarness;

UiAction last_action = UiAction::kNone;
void TestActionCallback(UiAction action) { last_action = action; }

constexpr MenuItem kTestItems[] = {
    {"Hilfe", UiAction::kNone},
    {"Letzte Nutzung", UiAction::kNone},
    {"MaCo Info", UiAction::kNone},
    {"Netzwerk", UiAction::kNone},
};

class MenuScreenTest : public ::testing::Test {
 protected:
  void SetUp() override {
    last_action = UiAction::kNone;
    ASSERT_EQ(harness_.Init(), pw::OkStatus());

    screen_ = std::make_unique<MenuScreen>(
        pw::span(kTestItems), TestActionCallback);
    ASSERT_EQ(harness_.ActivateScreen(*screen_), pw::OkStatus());
  }

  void TearDown() override {
    if (screen_) {
      screen_->OnDeactivate();
    }
  }

  ScreenshotTestHarness harness_;
  std::unique_ptr<MenuScreen> screen_;
};

TEST_F(MenuScreenTest, Render) {
  harness_.RenderFrame();

  EXPECT_TRUE(harness_.CompareToGolden(
      "maco_firmware/modules/terminal_ui/testdata/menu.png",
      "/tmp/menu_diff.png"));
}

TEST_F(MenuScreenTest, FocusedItem) {
  // Render multiple frames to let LVGL settle focus
  harness_.RenderFrame();
  harness_.RenderFrame();

  EXPECT_TRUE(harness_.CompareToGolden(
      "maco_firmware/modules/terminal_ui/testdata/menu_focused.png",
      "/tmp/menu_focused_diff.png"));
}

TEST_F(MenuScreenTest, ButtonConfig) {
  auto config = screen_->GetButtonConfig();
  EXPECT_EQ(config.cancel.label, "Zurück");
  EXPECT_EQ(config.ok.label, "Wählen");
  EXPECT_EQ(config.ok.bg_color, theme::kColorBtnGreen);
  EXPECT_EQ(config.cancel.bg_color, theme::kColorYellow);
}

TEST_F(MenuScreenTest, ScreenStyle) {
  auto style = screen_->GetScreenStyle();
  EXPECT_EQ(style.bg_color, theme::kColorWhiteBg);
}

}  // namespace
}  // namespace maco::terminal_ui
