// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/modules/terminal_ui/screens/main_screen.h"

#include "lvgl.h"
#include "maco_firmware/modules/terminal_ui/theme.h"
#include "pw_log/log.h"

namespace maco::terminal_ui {

namespace {

// Material Symbols UTF-8: U+E5C9 cancel
constexpr const char kIconCancel[] = "\xEE\x97\x89";

}  // namespace

MainScreen::MainScreen(ActionCallback action_callback)
    : Screen("Main"),
      action_callback_(std::move(action_callback)) {}

pw::Status MainScreen::OnActivate() {
  lv_screen_ = lv_obj_create(nullptr);
  if (!lv_screen_) {
    return pw::Status::Internal();
  }

  lv_group_ = lv_group_create();

  // Start with white (idle) background
  lv_obj_set_style_bg_color(
      lv_screen_, lv_color_hex(theme::kColorWhiteBg), LV_PART_MAIN);

  // --- Idle widgets ---
  machine_name_label_ = lv_label_create(lv_screen_);
  lv_label_set_text(machine_name_label_, "");
  lv_obj_set_style_text_font(machine_name_label_, &roboto_36, LV_PART_MAIN);
  lv_obj_set_style_text_color(machine_name_label_,
                              lv_color_hex(theme::kColorDarkText),
                              LV_PART_MAIN);
  lv_obj_align(machine_name_label_, LV_ALIGN_TOP_LEFT, 16, 56);

  instruction_label_ = lv_label_create(lv_screen_);
  lv_label_set_text(instruction_label_, "Mit Badge\nanmelden");
  lv_obj_set_style_text_font(instruction_label_, &roboto_24, LV_PART_MAIN);
  lv_obj_set_style_text_color(instruction_label_,
                              lv_color_hex(theme::kColorDarkText),
                              LV_PART_MAIN);
  lv_obj_align(instruction_label_, LV_ALIGN_TOP_LEFT, 16, 110);

  // Invisible button to capture OK key press for menu
  menu_btn_ = lv_button_create(lv_screen_);
  lv_obj_set_size(menu_btn_, 0, 0);
  lv_obj_add_flag(menu_btn_, LV_OBJ_FLAG_HIDDEN);
  lv_obj_add_event_cb(
      menu_btn_,
      [](lv_event_t* e) {
        auto* cb = static_cast<ActionCallback*>(lv_event_get_user_data(e));
        if (*cb) {
          (*cb)(UiAction::kOpenMenu);
        }
      },
      LV_EVENT_CLICKED,
      &action_callback_);
  AddToGroup(menu_btn_);

  // --- Active widgets (hidden initially) ---
  user_name_label_ = lv_label_create(lv_screen_);
  lv_label_set_text(user_name_label_, "");
  lv_obj_set_style_text_font(user_name_label_, &roboto_24, LV_PART_MAIN);
  lv_obj_set_style_text_color(user_name_label_, lv_color_white(),
                              LV_PART_MAIN);
  lv_obj_align(user_name_label_, LV_ALIGN_TOP_LEFT, 16, 56);
  lv_obj_add_flag(user_name_label_, LV_OBJ_FLAG_HIDDEN);

  timer_label_ = lv_label_create(lv_screen_);
  lv_label_set_text(timer_label_, "0 min");
  lv_obj_set_style_text_font(timer_label_, &roboto_36, LV_PART_MAIN);
  lv_obj_set_style_text_color(timer_label_, lv_color_white(), LV_PART_MAIN);
  lv_obj_align(timer_label_, LV_ALIGN_TOP_LEFT, 16, 90);
  lv_obj_add_flag(timer_label_, LV_OBJ_FLAG_HIDDEN);

  // --- Denied widgets (hidden initially) ---
  denied_icon_ = lv_label_create(lv_screen_);
  lv_label_set_text(denied_icon_, kIconCancel);
  lv_obj_set_style_text_font(denied_icon_, &material_symbols_64, LV_PART_MAIN);
  lv_obj_set_style_text_color(denied_icon_, lv_color_white(), LV_PART_MAIN);
  lv_obj_align(denied_icon_, LV_ALIGN_CENTER, 0, -20);
  lv_obj_add_flag(denied_icon_, LV_OBJ_FLAG_HIDDEN);

  denied_label_ = lv_label_create(lv_screen_);
  lv_label_set_text(denied_label_, "Nicht berechtigt");
  lv_obj_set_style_text_font(denied_label_, &roboto_24, LV_PART_MAIN);
  lv_obj_set_style_text_color(denied_label_, lv_color_white(), LV_PART_MAIN);
  lv_obj_align(denied_label_, LV_ALIGN_CENTER, 0, 30);
  lv_obj_add_flag(denied_label_, LV_OBJ_FLAG_HIDDEN);

  PW_LOG_INFO("MainScreen activated");
  return pw::OkStatus();
}

void MainScreen::OnDeactivate() {
  if (lv_group_) {
    lv_group_delete(lv_group_);
    lv_group_ = nullptr;
  }
  lv_screen_ = nullptr;
  machine_name_label_ = nullptr;
  instruction_label_ = nullptr;
  menu_btn_ = nullptr;
  user_name_label_ = nullptr;
  timer_label_ = nullptr;
  denied_icon_ = nullptr;
  denied_label_ = nullptr;
  PW_LOG_INFO("MainScreen deactivated");
}

void MainScreen::OnUpdate(const app_state::AppStateSnapshot& snapshot) {
  // Derive visual state from snapshot
  VisualState new_state;
  if (snapshot.session.state == app_state::SessionStateUi::kRunning) {
    new_state = VisualState::kActive;
  } else if (snapshot.verification.state ==
             app_state::TagVerificationState::kUnauthorized) {
    new_state = VisualState::kDenied;
  } else {
    new_state = VisualState::kIdle;
  }

  if (new_state != visual_state_) {
    SetVisualState(new_state);
  }

  // Update machine name from snapshot (may change if config reloads)
  machine_label_.Set(snapshot.system.machine_label);
  if (machine_label_.CheckAndClearDirty()) {
    lv_label_set_text(machine_name_label_, machine_label_.Get().c_str());
  }

  // Update active-state dynamic content
  if (visual_state_ == VisualState::kActive) {
    lv_label_set_text(user_name_label_,
                      snapshot.session.session_user_label.c_str());

    auto now = pw::chrono::SystemClock::now();
    auto elapsed = now - snapshot.session.session_started_at;
    auto minutes = std::chrono::duration_cast<std::chrono::minutes>(elapsed);
    lv_label_set_text_fmt(timer_label_, "%d min",
                          static_cast<int>(minutes.count()));
  }
}

bool MainScreen::OnEscapePressed() {
  if (visual_state_ == VisualState::kActive) {
    if (action_callback_) {
      action_callback_(UiAction::kStopSession);
    }
    return true;
  }
  if (visual_state_ == VisualState::kDenied) {
    // Denied auto-clears when tag verification resets to idle
    return true;
  }
  return false;
}

ui::ButtonConfig MainScreen::GetButtonConfig() const {
  switch (visual_state_) {
    case VisualState::kIdle:
      return {
          .ok = {.label = "Menü",
                 .led_color = theme::kColorYellow,
                 .bg_color = theme::kColorYellow,
                 .text_color = theme::kColorDarkText},
          .cancel = {},
      };
    case VisualState::kActive:
      return {
          .ok = {},
          .cancel = {.label = "Stopp",
                     .led_color = theme::kColorBtnRed,
                     .bg_color = theme::kColorBtnRed,
                     .text_color = 0xFFFFFF},
      };
    case VisualState::kDenied:
      return {
          .ok = {.label = "Zurück",
                 .led_color = theme::kColorYellow,
                 .bg_color = theme::kColorYellow,
                 .text_color = theme::kColorDarkText},
          .cancel = {},
      };
  }
  return {};
}

ui::ScreenStyle MainScreen::GetScreenStyle() const {
  switch (visual_state_) {
    case VisualState::kIdle:
      return {.bg_color = theme::kColorWhiteBg};
    case VisualState::kActive:
      return {.bg_color = theme::kColorGreen};
    case VisualState::kDenied:
      return {.bg_color = theme::kColorRed};
  }
  return {};
}

void MainScreen::SetVisualState(VisualState state) {
  visual_state_ = state;
  HideAllWidgets();

  uint32_t bg_color = theme::kColorWhiteBg;
  switch (state) {
    case VisualState::kIdle:
      lv_obj_remove_flag(machine_name_label_, LV_OBJ_FLAG_HIDDEN);
      lv_obj_remove_flag(instruction_label_, LV_OBJ_FLAG_HIDDEN);
      lv_obj_remove_flag(menu_btn_, LV_OBJ_FLAG_HIDDEN);
      break;
    case VisualState::kActive:
      bg_color = theme::kColorGreen;
      lv_obj_remove_flag(user_name_label_, LV_OBJ_FLAG_HIDDEN);
      lv_obj_remove_flag(timer_label_, LV_OBJ_FLAG_HIDDEN);
      break;
    case VisualState::kDenied:
      bg_color = theme::kColorRed;
      lv_obj_remove_flag(denied_icon_, LV_OBJ_FLAG_HIDDEN);
      lv_obj_remove_flag(denied_label_, LV_OBJ_FLAG_HIDDEN);
      break;
  }

  lv_obj_set_style_bg_color(lv_screen_, lv_color_hex(bg_color), LV_PART_MAIN);
  MarkDirty();
}

void MainScreen::HideAllWidgets() {
  lv_obj_add_flag(machine_name_label_, LV_OBJ_FLAG_HIDDEN);
  lv_obj_add_flag(instruction_label_, LV_OBJ_FLAG_HIDDEN);
  lv_obj_add_flag(menu_btn_, LV_OBJ_FLAG_HIDDEN);
  lv_obj_add_flag(user_name_label_, LV_OBJ_FLAG_HIDDEN);
  lv_obj_add_flag(timer_label_, LV_OBJ_FLAG_HIDDEN);
  lv_obj_add_flag(denied_icon_, LV_OBJ_FLAG_HIDDEN);
  lv_obj_add_flag(denied_label_, LV_OBJ_FLAG_HIDDEN);
}

}  // namespace maco::terminal_ui
