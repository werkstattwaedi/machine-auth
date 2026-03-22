// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/modules/terminal_ui/screens/main_screen.h"

#include <algorithm>

#include "lvgl.h"
#include "maco_firmware/modules/led_animator/button_effects.h"
#include "maco_firmware/modules/terminal_ui/theme.h"
#include "pw_log/log.h"

namespace maco::terminal_ui {

namespace {

// Material Symbols UTF-8 codepoints
constexpr const char kIconCancel[] = "\xEE\x97\x89";    // U+E5C9
constexpr const char kIconSchedule[] = "\xEE\xBF\x96";  // U+EFD6

constexpr int kContentPadding = 16;
constexpr int kUsableWidth = 208;   // 240 - 2*16px padding
constexpr int kTimerLabelX = 44;    // kContentPadding + 24px icon + 4px gap

// Format elapsed time: "< 1 min", "47 min", "1h05", "2h30"
void FormatElapsedTime(char* buf, size_t buf_size,
                       pw::chrono::SystemClock::time_point started_at) {
  auto now = pw::chrono::SystemClock::now();
  auto elapsed = now - started_at;
  auto total_minutes =
      std::chrono::duration_cast<std::chrono::minutes>(elapsed).count();
  if (total_minutes < 1) {
    lv_snprintf(buf, buf_size, "< 1 min");
  } else if (total_minutes < 60) {
    lv_snprintf(buf, buf_size, "%d min", static_cast<int>(total_minutes));
  } else {
    int hours = static_cast<int>(total_minutes / 60);
    int mins = static_cast<int>(total_minutes % 60);
    lv_snprintf(buf, buf_size, "%dh%02d", hours, mins);
  }
}

}  // namespace

MainScreen::MainScreen(ActionCallback action_callback)
    : Screen("Main"),
      action_callback_(std::move(action_callback)),
      overlay_(action_callback_) {}

pw::Status MainScreen::OnActivate() {
  lv_screen_ = lv_obj_create(nullptr);
  if (!lv_screen_) {
    return pw::Status::Internal();
  }

  lv_group_ = lv_group_create();

  lv_obj_clear_flag(lv_screen_, LV_OBJ_FLAG_SCROLLABLE);

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
  lv_obj_set_width(machine_name_label_, kUsableWidth);
  lv_label_set_long_mode(machine_name_label_, LV_LABEL_LONG_DOT);
  lv_obj_align(machine_name_label_, LV_ALIGN_TOP_LEFT, kContentPadding, 56);

  instruction_label_ = lv_label_create(lv_screen_);
  lv_label_set_text(instruction_label_, "Mit Badge\nanmelden");
  lv_obj_set_style_text_font(instruction_label_, &roboto_24, LV_PART_MAIN);
  lv_obj_set_style_text_color(instruction_label_,
                              lv_color_hex(theme::kColorDarkText),
                              LV_PART_MAIN);
  lv_obj_align(instruction_label_, LV_ALIGN_TOP_LEFT, kContentPadding, 110);

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
      LV_EVENT_PRESSED,
      &action_callback_);
  AddToGroup(menu_btn_);

  // --- Active widgets (hidden initially) ---
  user_name_label_ = lv_label_create(lv_screen_);
  lv_label_set_text(user_name_label_, "");
  lv_obj_set_style_text_font(user_name_label_, &roboto_36, LV_PART_MAIN);
  lv_obj_set_style_text_color(user_name_label_, lv_color_white(),
                              LV_PART_MAIN);
  lv_obj_set_width(user_name_label_, kUsableWidth);
  lv_label_set_long_mode(user_name_label_, LV_LABEL_LONG_DOT);
  lv_obj_align(user_name_label_, LV_ALIGN_TOP_LEFT, kContentPadding, 78);
  lv_obj_add_flag(user_name_label_, LV_OBJ_FLAG_HIDDEN);

  timer_icon_ = lv_label_create(lv_screen_);
  lv_label_set_text(timer_icon_, kIconSchedule);
  lv_obj_set_style_text_font(timer_icon_, &material_symbols_24, LV_PART_MAIN);
  lv_obj_set_style_text_color(timer_icon_, lv_color_white(), LV_PART_MAIN);
  lv_obj_align(timer_icon_, LV_ALIGN_TOP_LEFT, kContentPadding, 126);
  lv_obj_add_flag(timer_icon_, LV_OBJ_FLAG_HIDDEN);

  timer_label_ = lv_label_create(lv_screen_);
  lv_label_set_text(timer_label_, "< 1 min");
  lv_obj_set_style_text_font(timer_label_, &roboto_16, LV_PART_MAIN);
  lv_obj_set_style_text_color(timer_label_, lv_color_white(), LV_PART_MAIN);
  lv_obj_align(timer_label_, LV_ALIGN_TOP_LEFT, kTimerLabelX, 126);
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

  // --- Confirmation overlay (created last for z-order) ---
  overlay_.Create(lv_screen_, lv_group_);

  // Initialize widget visibility for the starting state
  SetVisualState(visual_state_);

  // Widgets were recreated — force Watched values to re-push on next OnUpdate()
  machine_label_.MarkDirty();

  PW_LOG_INFO("MainScreen activated");
  return pw::OkStatus();
}

void MainScreen::OnDeactivate() {
  overlay_.Destroy();
  if (lv_group_) {
    lv_group_delete(lv_group_);
    lv_group_ = nullptr;
  }
  lv_screen_ = nullptr;
  machine_name_label_ = nullptr;
  instruction_label_ = nullptr;
  menu_btn_ = nullptr;
  user_name_label_ = nullptr;
  timer_icon_ = nullptr;
  timer_label_ = nullptr;
  denied_icon_ = nullptr;
  denied_label_ = nullptr;
  PW_LOG_INFO("MainScreen deactivated");
}

void MainScreen::OnUpdate(const app_state::AppStateSnapshot& snapshot) {
  // Determine if a pending state is active
  bool is_pending =
      snapshot.session.state == app_state::SessionStateUi::kCheckoutPending ||
      snapshot.session.state == app_state::SessionStateUi::kTakeoverPending ||
      snapshot.session.state == app_state::SessionStateUi::kStopPending;

  // Derive visual state — pending states show as Active + overlay
  VisualState new_state;
  if (snapshot.session.state == app_state::SessionStateUi::kRunning ||
      is_pending) {
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

  // Update active-state dynamic content (including when overlay is visible)
  if (visual_state_ == VisualState::kActive) {
    lv_label_set_text(user_name_label_,
                      snapshot.session.session_user_label.c_str());

    char time_buf[16];
    FormatElapsedTime(time_buf, sizeof(time_buf),
                      snapshot.session.session_started_at);
    lv_label_set_text(timer_label_, time_buf);
  }

  // Manage overlay visibility
  if (is_pending) {
    PendingType type;
    std::string_view takeover_label;
    if (snapshot.session.state == app_state::SessionStateUi::kCheckoutPending) {
      type = PendingType::kCheckout;
    } else if (snapshot.session.state ==
               app_state::SessionStateUi::kTakeoverPending) {
      type = PendingType::kTakeover;
      takeover_label = std::string_view(
          snapshot.session.pending_user_label.data(),
          snapshot.session.pending_user_label.size());
    } else {
      type = PendingType::kStop;
    }

    if (!overlay_.IsVisible()) {
      // Hide menu button so only confirm_btn_ is focusable — prevents
      // AppShell from lighting up the navigation LEDs.
      lv_obj_add_flag(menu_btn_, LV_OBJ_FLAG_HIDDEN);
      overlay_.Show(type, takeover_label);
    } else if (type == PendingType::kTakeover) {
      overlay_.SetTakeoverLabel(takeover_label);
    }

    overlay_.UpdateProgress(snapshot.session.pending_since,
                            snapshot.session.pending_deadline,
                            snapshot.session.tag_present);
    MarkDirty();
  } else if (overlay_.IsVisible()) {
    overlay_.Hide();
    // Restore menu button and focus when overlay dismissed
    lv_obj_remove_flag(menu_btn_, LV_OBJ_FLAG_HIDDEN);
    if (lv_group_) {
      lv_group_focus_obj(menu_btn_);
    }
    MarkDirty();
  }
}

bool MainScreen::OnEscapePressed() {
  if (overlay_.IsVisible()) {
    if (action_callback_) {
      action_callback_(UiAction::kCancel);
    }
    return true;
  }
  if (visual_state_ == VisualState::kActive) {
    if (action_callback_) {
      action_callback_(UiAction::kStopSession);
    }
    return true;
  }
  if (visual_state_ == VisualState::kDenied) {
    return true;
  }
  return false;
}

ui::ButtonConfig MainScreen::GetButtonConfig() const {
  if (overlay_.IsVisible()) {
    return overlay_.GetButtonConfig();
  }

  switch (visual_state_) {
    case VisualState::kIdle:
      return {
          .ok = {.label = "Menü",
                 .led_effect = led_animator::SolidButton(
                     led::RgbwColor::FromRgb(theme::kColorYellow)),
                 .bg_color = theme::kColorYellow,
                 .text_color = theme::kColorDarkText},
          .cancel = {},
      };
    case VisualState::kActive:
      return {
          .ok = {.label = "Menü",
                 .led_effect = led_animator::SolidButton(
                     led::RgbwColor::FromRgb(theme::kColorYellow)),
                 .bg_color = theme::kColorYellow,
                 .text_color = theme::kColorDarkText},
          .cancel = {.label = "Stopp",
                     .led_effect = led_animator::SolidButton(
                         led::RgbwColor::FromRgb(theme::kColorBtnRed)),
                     .bg_color = theme::kColorBtnRed,
                     .text_color = 0xFFFFFF},
      };
    case VisualState::kDenied:
      return {
          .ok = {.label = "Zurück",
                 .led_effect = led_animator::SolidButton(
                     led::RgbwColor::FromRgb(theme::kColorYellow)),
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

void MainScreen::ConfigureMachineLabel(bool idle_mode) {
  if (idle_mode) {
    lv_obj_set_style_text_font(machine_name_label_, &roboto_36, LV_PART_MAIN);
    lv_obj_set_style_text_color(machine_name_label_,
                                lv_color_hex(theme::kColorDarkText),
                                LV_PART_MAIN);
    lv_obj_align(machine_name_label_, LV_ALIGN_TOP_LEFT, kContentPadding, 56);
  } else {
    lv_obj_set_style_text_font(machine_name_label_, &roboto_24, LV_PART_MAIN);
    lv_obj_align(machine_name_label_, LV_ALIGN_TOP_LEFT, kContentPadding, 44);
  }
}

void MainScreen::SetVisualState(VisualState state) {
  visual_state_ = state;
  HideAllWidgets();

  uint32_t bg_color = theme::kColorWhiteBg;
  switch (state) {
    case VisualState::kIdle:
      ConfigureMachineLabel(true);
      lv_obj_remove_flag(machine_name_label_, LV_OBJ_FLAG_HIDDEN);
      lv_obj_remove_flag(instruction_label_, LV_OBJ_FLAG_HIDDEN);
      lv_obj_remove_flag(menu_btn_, LV_OBJ_FLAG_HIDDEN);
      if (lv_group_) {
        lv_group_focus_obj(menu_btn_);
      }
      break;
    case VisualState::kActive:
      bg_color = theme::kColorGreen;
      ConfigureMachineLabel(false);
      lv_obj_set_style_text_color(machine_name_label_, lv_color_white(),
                                  LV_PART_MAIN);
      lv_obj_set_style_text_color(user_name_label_, lv_color_white(),
                                  LV_PART_MAIN);
      lv_obj_set_style_text_color(timer_icon_, lv_color_white(), LV_PART_MAIN);
      lv_obj_set_style_text_color(timer_label_, lv_color_white(), LV_PART_MAIN);
      lv_obj_remove_flag(machine_name_label_, LV_OBJ_FLAG_HIDDEN);
      lv_obj_remove_flag(user_name_label_, LV_OBJ_FLAG_HIDDEN);
      lv_obj_remove_flag(timer_icon_, LV_OBJ_FLAG_HIDDEN);
      lv_obj_remove_flag(timer_label_, LV_OBJ_FLAG_HIDDEN);
      lv_obj_remove_flag(menu_btn_, LV_OBJ_FLAG_HIDDEN);
      if (lv_group_) {
        lv_group_focus_obj(menu_btn_);
      }
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
  lv_obj_add_flag(timer_icon_, LV_OBJ_FLAG_HIDDEN);
  lv_obj_add_flag(timer_label_, LV_OBJ_FLAG_HIDDEN);
  lv_obj_add_flag(denied_icon_, LV_OBJ_FLAG_HIDDEN);
  lv_obj_add_flag(denied_label_, LV_OBJ_FLAG_HIDDEN);
}

}  // namespace maco::terminal_ui
