// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/modules/terminal_ui/screens/main_screen.h"

#include "lvgl.h"
#include "maco_firmware/modules/terminal_ui/theme.h"
#include "pw_log/log.h"

namespace maco::terminal_ui {

MainScreen::MainScreen(ActionCallback action_callback)
    : Screen("Main"), action_callback_(std::move(action_callback)) {}

pw::Status MainScreen::OnActivate() {
  lv_screen_ = lv_obj_create(nullptr);
  if (!lv_screen_) {
    return pw::Status::Internal();
  }

  lv_group_ = lv_group_create();

  lv_obj_set_style_bg_color(
      lv_screen_, lv_color_hex(theme::kColorBg), LV_PART_MAIN);

  // NFC icon (using LVGL symbol as placeholder)
  nfc_icon_ = lv_label_create(lv_screen_);
  lv_label_set_text(nfc_icon_, LV_SYMBOL_WIFI);
  lv_obj_set_style_text_color(
      nfc_icon_, lv_color_hex(theme::kColorTeal), LV_PART_MAIN);
  lv_obj_set_style_text_font(nfc_icon_, &roboto_24, LV_PART_MAIN);
  lv_obj_align(nfc_icon_, LV_ALIGN_CENTER, 0, -30);

  // Main prompt
  title_label_ = lv_label_create(lv_screen_);
  lv_label_set_text(title_label_, "Mit Badge anmelden");
  lv_obj_set_style_text_color(
      title_label_, lv_color_hex(theme::kColorText), LV_PART_MAIN);
  lv_obj_set_style_text_font(title_label_, &roboto_24, LV_PART_MAIN);
  lv_obj_align(title_label_, LV_ALIGN_CENTER, 0, 10);

  // Instruction text
  instruction_label_ = lv_label_create(lv_screen_);
  lv_label_set_text(instruction_label_, "Badge an Leser halten");
  lv_obj_set_style_text_color(
      instruction_label_, lv_color_hex(theme::kColorMuted), LV_PART_MAIN);
  lv_obj_set_style_text_font(instruction_label_, &roboto_12, LV_PART_MAIN);
  lv_obj_align(instruction_label_, LV_ALIGN_CENTER, 0, 40);

  // Invisible button to capture OK key press for menu
  lv_obj_t* menu_btn = lv_button_create(lv_screen_);
  lv_obj_set_size(menu_btn, 0, 0);
  lv_obj_add_flag(menu_btn, LV_OBJ_FLAG_HIDDEN);
  lv_obj_add_event_cb(
      menu_btn,
      [](lv_event_t* e) {
        auto* cb = static_cast<ActionCallback*>(lv_event_get_user_data(e));
        if (*cb) {
          (*cb)(UiAction::kOpenMenu);
        }
      },
      LV_EVENT_CLICKED,
      &action_callback_);
  AddToGroup(menu_btn);

  PW_LOG_INFO("MainScreen activated");
  return pw::OkStatus();
}

void MainScreen::OnDeactivate() {
  if (lv_group_) {
    lv_group_delete(lv_group_);
    lv_group_ = nullptr;
  }
  // lv_screen_ is not deleted here - LVGL's auto_del in
  // lv_screen_load_anim() handles cleanup after the crossfade.
  lv_screen_ = nullptr;
  nfc_icon_ = nullptr;
  title_label_ = nullptr;
  instruction_label_ = nullptr;
  PW_LOG_INFO("MainScreen deactivated");
}

void MainScreen::OnUpdate(
    [[maybe_unused]] const app_state::AppStateSnapshot& snapshot) {
  // Phase 1: idle mode only - no state-driven updates yet
}

ui::ButtonConfig MainScreen::GetButtonConfig() const {
  return {
      .cancel = {},
      .ok = {.label = "...", .led_color = theme::kColorTeal},
  };
}

}  // namespace maco::terminal_ui
