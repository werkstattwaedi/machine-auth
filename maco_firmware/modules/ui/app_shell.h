// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <memory>

#include "lvgl.h"
#include "maco_firmware/hardware.h"
#include "maco_firmware/modules/display/display.h"
#include "maco_firmware/modules/led_animator/button_effects.h"
#include "maco_firmware/modules/led_animator/led_animator.h"
#include "maco_firmware/modules/ui/screen.h"
#include "maco_firmware/modules/ui/widgets/button_bar.h"
#include "pw_containers/vector.h"
#include "pw_function/function.h"
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

  using SnapshotProvider = pw::Function<void(Snapshot&)>;

  /// Constructor with dependency injection (per ADR-0001).
  /// @param display Display module for UI rendering
  /// @param snapshot_provider Function to fetch snapshot
  /// @param animator Optional LED animator for driving button LEDs (may be null)
  AppShell(display::Display& display,
           SnapshotProvider snapshot_provider,
           led_animator::LedAnimatorBase* animator = nullptr)
      : display_(display),
        snapshot_provider_(std::move(snapshot_provider)),
        animator_(animator) {}

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
    // Process deferred ESC from LVGL event handler (set during previous frame)
    if (escape_pending_) {
      escape_pending_ = false;
      HandleEscapeKey();
    }

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

  /// Get the current screen's visual style (background color, etc.).
  ScreenStyle GetCurrentScreenStyle() const {
    if (Screen<Snapshot>* screen = current_screen()) {
      return screen->GetScreenStyle();
    }
    return {};
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
          screen->lv_screen(), LV_SCREEN_LOAD_ANIM_FADE_IN, 200, 0, true);

      // LVGL translates LV_KEY_ESC into LV_EVENT_CANCEL on the focused
      // widget. With EVENT_BUBBLE (set in AddToGroup), it propagates here.
      // Deferred to Update() to avoid modifying the screen stack during
      // LVGL event dispatch (which could corrupt group iteration state).
      lv_obj_add_event_cb(
          screen->lv_screen(),
          [](lv_event_t* e) {
            auto* self =
                static_cast<AppShell*>(lv_event_get_user_data(e));
            self->escape_pending_ = true;
          },
          LV_EVENT_CANCEL,
          this);
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

    if (animator_) {
      if (led_config_ != config) {
        led_config_ = config;
        animator_->SetButtonEffect(maco::Button::kBottomLeft,
                                   config.ok.led_effect);
        animator_->SetButtonEffect(maco::Button::kBottomRight,
                                   config.cancel.led_effect);
      }

      // Top-button LEDs reflect navigation availability: white when there is
      // more than one focusable object in the active group, off otherwise.
      led_animator::ButtonConfig nav_effect =
          (FocusableCount(active_group_) > 1)
              ? led_animator::SolidButton(led::RgbwColor::White())
              : led_animator::OffButton();
      if (nav_led_config_ != nav_effect) {
        nav_led_config_ = nav_effect;
        animator_->SetButtonEffect(maco::Button::kTopLeft, nav_effect);
        animator_->SetButtonEffect(maco::Button::kTopRight, nav_effect);
      }
    }
  }

  /// Count objects in the group that are neither hidden nor disabled.
  static uint32_t FocusableCount(lv_group_t* group) {
    if (!group) return 0;
    uint32_t count = 0;
    uint32_t total = lv_group_get_obj_count(group);
    for (uint32_t i = 0; i < total; i++) {
      lv_obj_t* obj = lv_group_get_obj_by_index(group, i);
      if (!lv_obj_has_flag(obj, LV_OBJ_FLAG_HIDDEN) &&
          !lv_obj_has_state(obj, LV_STATE_DISABLED)) {
        count++;
      }
    }
    return count;
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
  bool escape_pending_ = false;

  SnapshotProvider snapshot_provider_;
  Snapshot snapshots_[2];
  size_t current_snapshot_ = 0;

  led_animator::LedAnimatorBase* animator_ = nullptr;
  ButtonConfig led_config_{};                      // Last applied bottom-button LED config
  led_animator::ButtonConfig nav_led_config_{};    // Last applied top-button nav LED config
};

}  // namespace maco::ui
