// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/modules/terminal_ui/terminal_ui.h"

#include <memory>

#include "maco_firmware/modules/terminal_ui/screens/main_screen.h"
#include "maco_firmware/modules/terminal_ui/screens/menu_screen.h"
#include "maco_firmware/modules/terminal_ui/screens/splash_screen.h"
#include "maco_firmware/modules/terminal_ui/theme.h"
#include "pw_log/log.h"

namespace maco::terminal_ui {
namespace {

constexpr MenuItem kMenuItems[] = {
    {"Hilfe", UiAction::kNone},
    {"Letzte Nutzung", UiAction::kNone},
    {"MaCo Info", UiAction::kNone},
    {"Netzwerk", UiAction::kNone},
};

}  // namespace

TerminalUi::TerminalUi(display::Display& display,
                       app_state::SystemState& system_state)
    : display_(display),
      system_state_(system_state),
      status_bar_(system_state),
      app_shell_(display, [this](app_state::AppStateSnapshot& snapshot) {
        if (controller_) {
          controller_->GetSnapshot(snapshot);
        }
        system_state_.GetSnapshot(snapshot.system);
      }) {
  display_.SetInitCallback([this]() {
    auto status = Init();
    if (!status.ok()) {
      PW_LOG_ERROR("TerminalUi init failed");
    }
  });
}

void TerminalUi::SetController(app_state::SessionController* controller) {
  controller_ = controller;
  ready_.store(true, std::memory_order_release);
}

pw::Status TerminalUi::Init() {
  PW_LOG_INFO("TerminalUi initializing...");

  // Initialize status bar (persistent chrome on lv_layer_top)
  auto status = status_bar_.Init();
  if (!status.ok()) {
    PW_LOG_WARN("StatusBar init failed (continuing)");
  }

  // Initialize AppShell with empty stack (splash is managed separately)
  status = app_shell_.Init();
  if (!status.ok()) {
    PW_LOG_ERROR("AppShell init failed");
    return status;
  }

  // Show splash screen via AppShell. auto_del=true in
  // lv_screen_load_anim ensures the splash LVGL screen survives
  // for the crossfade when transitioning to MainScreen.
  auto s = app_shell_.Reset(std::make_unique<SplashScreen>());
  if (!s.ok()) {
    PW_LOG_ERROR("Failed to show SplashScreen");
    return s;
  }
  in_splash_ = true;

  // Render loop: splash stays until SetController() signals readiness
  display_.SetUpdateCallback([this]() {
    if (in_splash_ && ready_.load(std::memory_order_acquire)) {
      TransitionToMain();
    }

    // Propagate current screen style to status bar
    auto style = app_shell_.GetCurrentScreenStyle();
    status_bar_.SetBackgroundColor(style.bg_color);

    status_bar_.Update();
    app_shell_.Update();
  });

  PW_LOG_INFO("TerminalUi initialized");
  return pw::OkStatus();
}

void TerminalUi::TransitionToMain() {
  in_splash_ = false;

  auto s = app_shell_.Replace(
      std::make_unique<MainScreen>(
          [this](UiAction a) { HandleAction(a); }));
  if (!s.ok()) {
    PW_LOG_ERROR("Failed to transition to MainScreen");
    return;
  }

  PW_LOG_INFO("Splash done, showing MainScreen");
}

void TerminalUi::HandleAction(UiAction action) {
  switch (action) {
    case UiAction::kOpenMenu:
      PW_LOG_INFO("Opening menu");
      (void)app_shell_.Push(std::make_unique<MenuScreen>(
          pw::span(kMenuItems),
          [this](UiAction a) { HandleAction(a); }));
      break;

    case UiAction::kCloseMenu:
      PW_LOG_INFO("Closing menu");
      (void)app_shell_.Pop();
      break;

    case UiAction::kConfirm:
      if (controller_) {
        controller_->PostUiAction(app_state::SessionAction::kConfirm);
      }
      break;

    case UiAction::kCancel:
      if (controller_) {
        controller_->PostUiAction(app_state::SessionAction::kCancel);
      }
      break;

    case UiAction::kStopSession:
      PW_LOG_INFO("Stop session requested");
      if (controller_) {
        controller_->PostUiAction(app_state::SessionAction::kCancel);
      }
      break;

    case UiAction::kNone:
      break;
  }
}

}  // namespace maco::terminal_ui
