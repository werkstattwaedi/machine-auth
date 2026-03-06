// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/modules/terminal_ui/screens/main_screen.h"

#include "gtest/gtest.h"
#include "maco_firmware/modules/app_state/system_monitor_backend.h"
#include "maco_firmware/modules/app_state/system_state.h"
#include "maco_firmware/modules/display/testing/screenshot_test_harness.h"
#include "maco_firmware/modules/status_bar/status_bar.h"
#include "maco_firmware/modules/terminal_ui/theme.h"
#include "maco_firmware/modules/ui/widgets/button_bar.h"
#include "pw_chrono/system_clock.h"

namespace maco::terminal_ui {
namespace {

using display::testing::ScreenshotTestHarness;

// Trivial backend stub — Start() is a no-op.
class NullSystemMonitorBackend : public app_state::SystemMonitorBackend {
 public:
  void Start(app_state::SystemStateUpdater&,
             pw::async2::Dispatcher&) override {}
};

// Track actions emitted by the screen
UiAction last_action = UiAction::kNone;
void TestActionCallback(UiAction action) { last_action = action; }

class MainScreenTest : public ::testing::Test {
 protected:
  void SetUp() override {
    last_action = UiAction::kNone;
    ASSERT_EQ(harness_.Init(), pw::OkStatus());

    // Set up status bar with static state (wifi+gateway connected, 14:30 CET)
    // Compute offset so GetSnapshot() always yields 14:30 CET (= 13:30 UTC).
    // Target: 2026-01-15 13:30:00 UTC (CET = UTC+1, so 14:30 local)
    constexpr int64_t kTargetUtcSecs = 1768483800;  // 2026-01-15 13:30 UTC
    auto boot_secs =
        std::chrono::duration_cast<std::chrono::seconds>(
            pw::chrono::SystemClock::now().time_since_epoch())
            .count();
    system_state_.SetWifiState(app_state::WifiState::kConnected);
    system_state_.SetGatewayConnected(true);
    system_state_.SetUtcBootOffsetSeconds(kTargetUtcSecs - boot_secs);
    status_bar_ = std::make_unique<status_bar::StatusBar>(system_state_);
    ASSERT_EQ(status_bar_->Init(), pw::OkStatus());
    status_bar_->SetVisible(true);

    // Set up button bar
    button_bar_ = std::make_unique<ui::ButtonBar>(lv_layer_top());

    screen_ = std::make_unique<MainScreen>(TestActionCallback);
    ASSERT_EQ(harness_.ActivateScreen(*screen_), pw::OkStatus());
  }

  void TearDown() override {
    if (screen_) {
      screen_->OnDeactivate();
    }
    button_bar_.reset();
    status_bar_.reset();
  }

  /// Render a frame with status bar and button bar chrome.
  void RenderFrame() {
    auto style = screen_->GetScreenStyle();
    status_bar_->SetBackgroundColor(style.bg_color);
    status_bar_->Update();
    button_bar_->SetConfig(screen_->GetButtonConfig());
    button_bar_->Update();
    harness_.RenderFrame();
  }

  NullSystemMonitorBackend monitor_backend_;
  app_state::SystemState system_state_{monitor_backend_};
  ScreenshotTestHarness harness_;
  std::unique_ptr<status_bar::StatusBar> status_bar_;
  std::unique_ptr<ui::ButtonBar> button_bar_;
  std::unique_ptr<MainScreen> screen_;
};

TEST_F(MainScreenTest, Idle) {
  app_state::AppStateSnapshot snapshot;
  snapshot.system.machine_label = "Fräse";
  screen_->OnUpdate(snapshot);
  RenderFrame();

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
  snapshot.system.machine_label = "Fräse";
  screen_->OnUpdate(snapshot);
  RenderFrame();

  EXPECT_TRUE(harness_.CompareToGolden(
      "maco_firmware/modules/terminal_ui/testdata/main_active.png",
      "/tmp/main_active_diff.png"));

  auto config = screen_->GetButtonConfig();
  EXPECT_EQ(config.ok.label, "Menü");
  EXPECT_EQ(config.ok.bg_color, theme::kColorYellow);
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

TEST_F(MainScreenTest, ActiveTimeHours) {
  app_state::AppStateSnapshot snapshot;
  snapshot.session.state = app_state::SessionStateUi::kRunning;
  snapshot.session.session_user_label = "Simon Flepp";
  snapshot.session.session_started_at =
      pw::chrono::SystemClock::now() - std::chrono::minutes(125);
  snapshot.system.machine_label = "Fräse";
  screen_->OnUpdate(snapshot);
  RenderFrame();

  EXPECT_TRUE(harness_.CompareToGolden(
      "maco_firmware/modules/terminal_ui/testdata/main_active_hours.png",
      "/tmp/main_active_hours_diff.png"));
}

TEST_F(MainScreenTest, DeniedState) {
  app_state::AppStateSnapshot snapshot;
  snapshot.verification.state =
      app_state::TagVerificationState::kUnauthorized;
  screen_->OnUpdate(snapshot);
  RenderFrame();

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

// --- Pending state tests ---

TEST_F(MainScreenTest, CheckoutPendingState) {
  app_state::AppStateSnapshot snapshot;
  snapshot.session.state = app_state::SessionStateUi::kCheckoutPending;
  snapshot.session.session_user_label = "Simon Flepp";
  snapshot.session.session_started_at =
      pw::chrono::SystemClock::now() - std::chrono::minutes(47);
  snapshot.system.machine_label = "Fräse";
  auto now = pw::chrono::SystemClock::now();
  snapshot.session.pending_since = now;
  snapshot.session.pending_deadline = now + std::chrono::seconds(3);
  snapshot.session.tag_present = true;
  screen_->OnUpdate(snapshot);
  RenderFrame();

  EXPECT_TRUE(harness_.CompareToGolden(
      "maco_firmware/modules/terminal_ui/testdata/main_checkout_pending.png",
      "/tmp/main_checkout_pending_diff.png"));
}

TEST_F(MainScreenTest, CheckoutPendingButtonConfig) {
  app_state::AppStateSnapshot snapshot;
  snapshot.session.state = app_state::SessionStateUi::kCheckoutPending;
  auto now = pw::chrono::SystemClock::now();
  snapshot.session.pending_since = now;
  snapshot.session.pending_deadline = now + std::chrono::seconds(3);
  snapshot.session.tag_present = true;
  screen_->OnUpdate(snapshot);

  auto config = screen_->GetButtonConfig();
  EXPECT_EQ(config.ok.label, "Ja");
  EXPECT_EQ(config.ok.bg_color, theme::kColorBtnGreen);
  EXPECT_EQ(config.cancel.label, "Nein");
  EXPECT_EQ(config.cancel.bg_color, theme::kColorBtnRed);
  // With tag present, ok has progress, cancel does not
  EXPECT_GE(config.ok.fill_progress, 1);
  EXPECT_EQ(config.cancel.fill_progress, 0);
}

TEST_F(MainScreenTest, CheckoutPendingScreenStyle) {
  app_state::AppStateSnapshot snapshot;
  snapshot.session.state = app_state::SessionStateUi::kCheckoutPending;
  screen_->OnUpdate(snapshot);

  auto style = screen_->GetScreenStyle();
  EXPECT_EQ(style.bg_color, theme::kColorGreen);
}

TEST_F(MainScreenTest, TakeoverPendingState) {
  app_state::AppStateSnapshot snapshot;
  snapshot.session.state = app_state::SessionStateUi::kTakeoverPending;
  snapshot.session.session_user_label = "Simon Flepp";
  snapshot.session.pending_user_label = "Mike";
  snapshot.session.session_started_at =
      pw::chrono::SystemClock::now() - std::chrono::minutes(47);
  snapshot.system.machine_label = "Fräse";
  auto now = pw::chrono::SystemClock::now();
  snapshot.session.pending_since = now;
  snapshot.session.pending_deadline = now + std::chrono::seconds(3);
  snapshot.session.tag_present = true;
  screen_->OnUpdate(snapshot);
  RenderFrame();

  EXPECT_TRUE(harness_.CompareToGolden(
      "maco_firmware/modules/terminal_ui/testdata/main_takeover_pending.png",
      "/tmp/main_takeover_pending_diff.png"));
}

TEST_F(MainScreenTest, TakeoverPendingButtonConfig) {
  app_state::AppStateSnapshot snapshot;
  snapshot.session.state = app_state::SessionStateUi::kTakeoverPending;
  auto now = pw::chrono::SystemClock::now();
  snapshot.session.pending_since = now;
  snapshot.session.pending_deadline = now + std::chrono::seconds(3);
  snapshot.session.tag_present = true;
  screen_->OnUpdate(snapshot);

  auto config = screen_->GetButtonConfig();
  EXPECT_EQ(config.ok.label, "Ja");
  EXPECT_EQ(config.ok.bg_color, theme::kColorBtnGreen);
  EXPECT_EQ(config.cancel.label, "Nein");
  EXPECT_EQ(config.cancel.bg_color, theme::kColorBtnRed);
  // With tag present, ok (Ja) has progress
  EXPECT_GE(config.ok.fill_progress, 1);
  EXPECT_EQ(config.cancel.fill_progress, 0);
}

TEST_F(MainScreenTest, TakeoverPendingButtonConfigBadgeRemoved) {
  app_state::AppStateSnapshot snapshot;
  snapshot.session.state = app_state::SessionStateUi::kTakeoverPending;
  auto now = pw::chrono::SystemClock::now();
  snapshot.session.pending_since = now;
  snapshot.session.pending_deadline = now + std::chrono::seconds(3);
  snapshot.session.tag_present = false;
  screen_->OnUpdate(snapshot);

  auto config = screen_->GetButtonConfig();
  EXPECT_EQ(config.ok.label, "Ja");
  EXPECT_EQ(config.cancel.label, "Nein");
  // With tag removed, cancel (Nein) has progress
  EXPECT_EQ(config.ok.fill_progress, 0);
  EXPECT_GE(config.cancel.fill_progress, 1);
}

TEST_F(MainScreenTest, TakeoverPendingScreenStyle) {
  app_state::AppStateSnapshot snapshot;
  snapshot.session.state = app_state::SessionStateUi::kTakeoverPending;
  screen_->OnUpdate(snapshot);

  auto style = screen_->GetScreenStyle();
  EXPECT_EQ(style.bg_color, theme::kColorGreen);
}

TEST_F(MainScreenTest, StopPendingState) {
  app_state::AppStateSnapshot snapshot;
  snapshot.session.state = app_state::SessionStateUi::kStopPending;
  snapshot.session.session_user_label = "Simon Flepp";
  snapshot.session.session_started_at =
      pw::chrono::SystemClock::now() - std::chrono::minutes(47);
  snapshot.system.machine_label = "Fräse";
  auto now = pw::chrono::SystemClock::now();
  snapshot.session.pending_since = now;
  snapshot.session.pending_deadline = now + std::chrono::seconds(3);
  screen_->OnUpdate(snapshot);
  RenderFrame();

  EXPECT_TRUE(harness_.CompareToGolden(
      "maco_firmware/modules/terminal_ui/testdata/main_stop_pending.png",
      "/tmp/main_stop_pending_diff.png"));
}

TEST_F(MainScreenTest, StopPendingButtonConfig) {
  app_state::AppStateSnapshot snapshot;
  snapshot.session.state = app_state::SessionStateUi::kStopPending;
  auto now = pw::chrono::SystemClock::now();
  snapshot.session.pending_since = now;
  snapshot.session.pending_deadline = now + std::chrono::seconds(3);
  screen_->OnUpdate(snapshot);

  auto config = screen_->GetButtonConfig();
  EXPECT_EQ(config.ok.label, "Ja");
  EXPECT_EQ(config.ok.bg_color, theme::kColorBtnGreen);
  EXPECT_GE(config.ok.fill_progress, 1);
  EXPECT_EQ(config.cancel.label, "Nein");
  EXPECT_EQ(config.cancel.bg_color, theme::kColorBtnRed);
  EXPECT_EQ(config.cancel.fill_progress, 0);
}

TEST_F(MainScreenTest, StopPendingScreenStyle) {
  app_state::AppStateSnapshot snapshot;
  snapshot.session.state = app_state::SessionStateUi::kStopPending;
  screen_->OnUpdate(snapshot);

  auto style = screen_->GetScreenStyle();
  EXPECT_EQ(style.bg_color, theme::kColorGreen);
}

TEST_F(MainScreenTest, CancelActionFromStopPending) {
  app_state::AppStateSnapshot snapshot;
  snapshot.session.state = app_state::SessionStateUi::kStopPending;
  screen_->OnUpdate(snapshot);

  bool handled = screen_->OnEscapePressed();
  EXPECT_TRUE(handled);
  EXPECT_EQ(last_action, UiAction::kCancel);
}

TEST_F(MainScreenTest, CancelActionFromCheckoutPending) {
  app_state::AppStateSnapshot snapshot;
  snapshot.session.state = app_state::SessionStateUi::kCheckoutPending;
  screen_->OnUpdate(snapshot);

  bool handled = screen_->OnEscapePressed();
  EXPECT_TRUE(handled);
  EXPECT_EQ(last_action, UiAction::kCancel);
}

// --- Progress fill screenshot tests ---

TEST_F(MainScreenTest, StopPendingProgress0) {
  app_state::AppStateSnapshot snapshot;
  snapshot.session.state = app_state::SessionStateUi::kStopPending;
  snapshot.session.session_user_label = "Simon Flepp";
  snapshot.session.session_started_at =
      pw::chrono::SystemClock::now() - std::chrono::minutes(47);
  snapshot.system.machine_label = "Fräse";
  auto now = pw::chrono::SystemClock::now();
  snapshot.session.pending_since = now;
  snapshot.session.pending_deadline = now + std::chrono::seconds(3);
  screen_->OnUpdate(snapshot);
  RenderFrame();

  EXPECT_TRUE(harness_.CompareToGolden(
      "maco_firmware/modules/terminal_ui/testdata/stop_pending_progress_0.png",
      "/tmp/stop_pending_progress_0_diff.png"));
}

TEST_F(MainScreenTest, StopPendingProgress33) {
  app_state::AppStateSnapshot snapshot;
  snapshot.session.state = app_state::SessionStateUi::kStopPending;
  snapshot.session.session_user_label = "Simon Flepp";
  snapshot.session.session_started_at =
      pw::chrono::SystemClock::now() - std::chrono::minutes(47);
  snapshot.system.machine_label = "Fräse";
  auto now = pw::chrono::SystemClock::now();
  // 1s elapsed out of 3s = 33%
  snapshot.session.pending_since = now - std::chrono::seconds(1);
  snapshot.session.pending_deadline = now + std::chrono::seconds(2);
  screen_->OnUpdate(snapshot);
  RenderFrame();

  EXPECT_TRUE(harness_.CompareToGolden(
      "maco_firmware/modules/terminal_ui/testdata/stop_pending_progress_33.png",
      "/tmp/stop_pending_progress_33_diff.png"));
}

TEST_F(MainScreenTest, StopPendingProgress66) {
  app_state::AppStateSnapshot snapshot;
  snapshot.session.state = app_state::SessionStateUi::kStopPending;
  snapshot.session.session_user_label = "Simon Flepp";
  snapshot.session.session_started_at =
      pw::chrono::SystemClock::now() - std::chrono::minutes(47);
  snapshot.system.machine_label = "Fräse";
  auto now = pw::chrono::SystemClock::now();
  // 2s elapsed out of 3s = 66%
  snapshot.session.pending_since = now - std::chrono::seconds(2);
  snapshot.session.pending_deadline = now + std::chrono::seconds(1);
  screen_->OnUpdate(snapshot);
  RenderFrame();

  EXPECT_TRUE(harness_.CompareToGolden(
      "maco_firmware/modules/terminal_ui/testdata/stop_pending_progress_66.png",
      "/tmp/stop_pending_progress_66_diff.png"));
}

TEST_F(MainScreenTest, StopPendingProgress100) {
  app_state::AppStateSnapshot snapshot;
  snapshot.session.state = app_state::SessionStateUi::kStopPending;
  snapshot.session.session_user_label = "Simon Flepp";
  snapshot.session.session_started_at =
      pw::chrono::SystemClock::now() - std::chrono::minutes(47);
  snapshot.system.machine_label = "Fräse";
  auto now = pw::chrono::SystemClock::now();
  // 3s elapsed out of 3s = 100%
  snapshot.session.pending_since = now - std::chrono::seconds(3);
  snapshot.session.pending_deadline = now;
  screen_->OnUpdate(snapshot);
  RenderFrame();

  EXPECT_TRUE(harness_.CompareToGolden(
      "maco_firmware/modules/terminal_ui/testdata/stop_pending_progress_100.png",
      "/tmp/stop_pending_progress_100_diff.png"));
}

}  // namespace
}  // namespace maco::terminal_ui
