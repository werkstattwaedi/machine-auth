// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include "maco_firmware/modules/app_state/ui/snapshot.h"
#include "maco_firmware/modules/terminal_ui/ui_action.h"
#include "maco_firmware/modules/ui/data_binding.h"
#include "maco_firmware/modules/ui/screen.h"
#include "pw_chrono/system_clock.h"
#include "pw_string/string.h"

namespace maco::terminal_ui {

/// Primary screen for the terminal with three visual states:
///   - Idle: white bg, machine name, "Mit Badge anmelden"
///   - Active: green bg, user name, elapsed timer
///   - Denied: red bg, cancel icon, "Nicht berechtigt"
class MainScreen : public ui::Screen<app_state::AppStateSnapshot> {
 public:
  explicit MainScreen(ActionCallback action_callback);

  pw::Status OnActivate() override;
  void OnDeactivate() override;
  void OnUpdate(const app_state::AppStateSnapshot& snapshot) override;
  bool OnEscapePressed() override;
  ui::ButtonConfig GetButtonConfig() const override;
  ui::ScreenStyle GetScreenStyle() const override;

 private:
  enum class VisualState {
    kIdle,
    kActive,
    kDenied,
    kCheckoutPending,
    kTakeoverPending,
    kStopPending,
  };

  void SetVisualState(VisualState state);
  void HideAllWidgets();

  ActionCallback action_callback_;
  VisualState visual_state_ = VisualState::kIdle;
  ui::Watched<pw::InlineString<64>> machine_label_{pw::InlineString<64>()};

  // Idle widgets
  lv_obj_t* machine_name_label_ = nullptr;
  lv_obj_t* instruction_label_ = nullptr;
  lv_obj_t* menu_btn_ = nullptr;

  // Active widgets
  lv_obj_t* user_name_label_ = nullptr;
  lv_obj_t* timer_label_ = nullptr;

  // Denied widgets
  lv_obj_t* denied_icon_ = nullptr;
  lv_obj_t* denied_label_ = nullptr;

  // Pending widgets (checkout, takeover, stop)
  lv_obj_t* pending_title_label_ = nullptr;
  lv_obj_t* countdown_label_ = nullptr;
  lv_obj_t* confirm_btn_ = nullptr;  // Invisible OK handler for pending states

  uint8_t ComputePendingProgress() const;

  // Cached pending state for progress calculation in GetButtonConfig()
  pw::chrono::SystemClock::time_point cached_pending_since_;
  pw::chrono::SystemClock::time_point cached_pending_deadline_;
  pw::chrono::SystemClock::time_point cached_session_started_at_;
  bool cached_tag_present_ = false;
};

}  // namespace maco::terminal_ui
