// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/modules/terminal_ui/screens/main_screen.h"

#include "gtest/gtest.h"
#include "maco_firmware/modules/display/testing/screenshot_test_harness.h"
#include "maco_firmware/modules/terminal_ui/theme.h"

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
  snapshot.system.machine_label = "Fräse";
  screen_->OnUpdate(snapshot);
  harness_.RenderFrame();

  EXPECT_TRUE(harness_.CompareToGolden(
      "maco_firmware/modules/terminal_ui/testdata/main_idle.png",
      "/tmp/main_idle_diff.png"));
}

TEST_F(MainScreenTest, IdleButtonConfig) {
  auto config = screen_->GetButtonConfig();
  EXPECT_TRUE(config.cancel.label.empty());
  EXPECT_EQ(config.ok.label, "Menü");
  EXPECT_EQ(config.ok.bg_color, theme::kColorYellow);
}

TEST_F(MainScreenTest, IdleScreenStyle) {
  auto style = screen_->GetScreenStyle();
  EXPECT_EQ(style.bg_color, theme::kColorWhiteBg);
}

TEST_F(MainScreenTest, ActiveState) {
  app_state::AppStateSnapshot snapshot;
  snapshot.session.state = app_state::SessionStateUi::kRunning;
  snapshot.session.session_user_label = "Simon Flepp";
  snapshot.session.session_started_at = pw::chrono::SystemClock::now();
  screen_->OnUpdate(snapshot);
  harness_.RenderFrame();

  EXPECT_TRUE(harness_.CompareToGolden(
      "maco_firmware/modules/terminal_ui/testdata/main_active.png",
      "/tmp/main_active_diff.png"));

  auto config = screen_->GetButtonConfig();
  EXPECT_TRUE(config.ok.label.empty());
  EXPECT_EQ(config.cancel.label, "Stopp");
  EXPECT_EQ(config.cancel.bg_color, theme::kColorBtnRed);
}

TEST_F(MainScreenTest, ActiveScreenStyle) {
  app_state::AppStateSnapshot snapshot;
  snapshot.session.state = app_state::SessionStateUi::kRunning;
  screen_->OnUpdate(snapshot);

  auto style = screen_->GetScreenStyle();
  EXPECT_EQ(style.bg_color, theme::kColorGreen);
}

TEST_F(MainScreenTest, DeniedState) {
  app_state::AppStateSnapshot snapshot;
  snapshot.verification.state =
      app_state::TagVerificationState::kUnauthorized;
  screen_->OnUpdate(snapshot);
  harness_.RenderFrame();

  EXPECT_TRUE(harness_.CompareToGolden(
      "maco_firmware/modules/terminal_ui/testdata/main_denied.png",
      "/tmp/main_denied_diff.png"));

  auto config = screen_->GetButtonConfig();
  EXPECT_EQ(config.ok.label, "Zurück");
  EXPECT_TRUE(config.cancel.label.empty());
}

TEST_F(MainScreenTest, DeniedScreenStyle) {
  app_state::AppStateSnapshot snapshot;
  snapshot.verification.state =
      app_state::TagVerificationState::kUnauthorized;
  screen_->OnUpdate(snapshot);

  auto style = screen_->GetScreenStyle();
  EXPECT_EQ(style.bg_color, theme::kColorRed);
}

TEST_F(MainScreenTest, StopSessionAction) {
  // Put screen in active state
  app_state::AppStateSnapshot snapshot;
  snapshot.session.state = app_state::SessionStateUi::kRunning;
  screen_->OnUpdate(snapshot);

  // ESC in active state should emit kStopSession
  bool handled = screen_->OnEscapePressed();
  EXPECT_TRUE(handled);
  EXPECT_EQ(last_action, UiAction::kStopSession);
}

}  // namespace
}  // namespace maco::terminal_ui
