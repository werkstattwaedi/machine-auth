// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <memory>

#include "lvgl.h"
#include "maco_firmware/modules/display/display.h"
#include "maco_firmware/modules/ui/screen.h"
#include "maco_firmware/modules/ui/widgets/button_bar.h"
#include "pw_containers/vector.h"
#include "pw_log/log.h"
#include "pw_status/status.h"

namespace maco::ui {

/// AppShell manages screens, chrome, and state propagation.
///
/// Templated on Snapshot type so each app can compose its own state.
///
/// Responsibilities:
///   - Screen navigation (push/pop/replace/reset)
///   - Screen lifecycle management
///   - Button bar chrome (persistent on lv_layer_top)
///   - Snapshot delivery to screens
///
/// Usage:
///   auto provider = [&ctrl](auto& s) { ctrl.GetSnapshot(s); };
///   AppShell<MySnapshot> shell(display, provider);
///   shell.Init();
///   shell.Reset(std::make_unique<HomeScreen>(shell, deps...));
template <typename Snapshot>
class AppShell {
 public:
  static constexpr size_t kMaxNavigationDepth = 6;

  using SnapshotProvider = void (*)(Snapshot&);

  /// Constructor with dependency injection (per ADR-0001).
  /// @param display Display module for UI rendering
  /// @param snapshot_provider Function to fetch snapshot
  AppShell(display::Display& display, SnapshotProvider snapshot_provider)
      : display_(display), snapshot_provider_(snapshot_provider) {}

  ~AppShell() {
    while (!stack_.empty()) {
      DeactivateScreen(stack_.back().get());
      stack_.pop_back();
    }
  }

  // Non-copyable, non-movable
  AppShell(const AppShell&) = delete;
  AppShell& operator=(const AppShell&) = delete;

  /// Initialize chrome widgets (button bar on lv_layer_top).
  /// Must be called before any navigation.
  pw::Status Init() {
    button_bar_ = std::make_unique<ButtonBar>(lv_layer_top());
    display_.SetUpdateCallback([this]() { Update(); });
    PW_LOG_INFO("AppShell initialized");
    return pw::OkStatus();
  }

  /// Push a new screen onto the stack.
  pw::Status Push(std::unique_ptr<Screen<Snapshot>> screen) {
    if (stack_.full()) {
      PW_LOG_ERROR("Navigation stack full");
      return pw::Status::ResourceExhausted();
    }

    if (!stack_.empty()) {
      DeactivateScreen(stack_.back().get());
    }

    Screen<Snapshot>* new_screen = screen.get();
    stack_.push_back(std::move(screen));
    ActivateScreen(new_screen);

    PW_LOG_INFO("Pushed screen: %s", new_screen->debug_name().data());
    return pw::OkStatus();
  }

  /// Pop the current screen and return to previous.
  pw::Status Pop() {
    if (stack_.size() <= 1) {
      PW_LOG_WARN("Cannot pop last screen");
      return pw::Status::FailedPrecondition();
    }

    DeactivateScreen(stack_.back().get());
    PW_LOG_INFO("Popped screen: %s", stack_.back()->debug_name().data());
    stack_.pop_back();

    ActivateScreen(stack_.back().get());
    return pw::OkStatus();
  }

  /// Replace the current screen with a new one.
  pw::Status Replace(std::unique_ptr<Screen<Snapshot>> screen) {
    if (stack_.empty()) {
      return Push(std::move(screen));
    }

    DeactivateScreen(stack_.back().get());
    stack_.pop_back();

    Screen<Snapshot>* new_screen = screen.get();
    stack_.push_back(std::move(screen));
    ActivateScreen(new_screen);

    PW_LOG_INFO("Replaced with screen: %s", new_screen->debug_name().data());
    return pw::OkStatus();
  }

  /// Clear the stack and set a new root screen.
  pw::Status Reset(std::unique_ptr<Screen<Snapshot>> screen) {
    while (!stack_.empty()) {
      DeactivateScreen(stack_.back().get());
      stack_.pop_back();
    }

    Screen<Snapshot>* new_screen = screen.get();
    stack_.push_back(std::move(screen));
    ActivateScreen(new_screen);

    PW_LOG_INFO("Reset to screen: %s", new_screen->debug_name().data());
    return pw::OkStatus();
  }

  /// Called once per frame from Display callback.
  void Update() {
    snapshot_provider_(snapshots_[current_snapshot_]);

    if (Screen<Snapshot>* screen = current_screen()) {
      screen->OnUpdate(snapshots_[current_snapshot_]);
    }

    current_snapshot_ ^= 1;
    UpdateChrome();
  }

  /// Get the current active screen (top of stack).
  Screen<Snapshot>* current_screen() const {
    if (stack_.empty()) {
      return nullptr;
    }
    return stack_.back().get();
  }

 private:
  void ActivateScreen(Screen<Snapshot>* screen) {
    if (!screen) {
      return;
    }

    pw::Status status = screen->OnActivate();
    if (!status.ok()) {
      PW_LOG_ERROR("Screen activation failed: %s",
                   screen->debug_name().data());
      return;
    }

    if (screen->lv_screen()) {
      lv_screen_load_anim(
          screen->lv_screen(), LV_SCREEN_LOAD_ANIM_FADE_IN, 200, 0, false);
    }

    if (screen->lv_group()) {
      active_group_ = screen->lv_group();
      lv_indev_t* indev = lv_indev_get_next(nullptr);
      if (indev) {
        lv_indev_set_group(indev, active_group_);
      }
    }

    UpdateChrome();
  }

  void DeactivateScreen(Screen<Snapshot>* screen) {
    if (!screen) {
      return;
    }
    screen->OnDeactivate();
  }

  void UpdateChrome() {
    if (!button_bar_) {
      return;
    }

    ButtonConfig config;
    if (Screen<Snapshot>* screen = current_screen()) {
      config = screen->GetButtonConfig();
    }

    button_bar_->SetConfig(config);
    button_bar_->Update();
  }

  void HandleEscapeKey() {
    Screen<Snapshot>* screen = current_screen();
    if (!screen) {
      return;
    }

    if (screen->OnEscapePressed()) {
      return;
    }

    (void)Pop();
  }

  display::Display& display_;
  pw::Vector<std::unique_ptr<Screen<Snapshot>>, kMaxNavigationDepth> stack_;

  std::unique_ptr<ButtonBar> button_bar_;
  lv_group_t* active_group_ = nullptr;

  SnapshotProvider snapshot_provider_;
  Snapshot snapshots_[2];
  size_t current_snapshot_ = 0;
};

}  // namespace maco::ui
