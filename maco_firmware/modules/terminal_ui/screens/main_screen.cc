// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/modules/terminal_ui/screens/main_screen.h"

#include "lvgl.h"
#include "maco_firmware/modules/terminal_ui/theme.h"
#include "pw_log/log.h"

namespace maco::terminal_ui {

namespace {

// Shared label styles, initialized once on first OnActivate() call.
lv_style_t g_style_nfc_icon;   // teal + material_symbols_24
lv_style_t g_style_title;      // primary text color + roboto_24
lv_style_t g_style_instruction;  // muted text color + roboto_12

void EnsureStylesInit() {
  static bool initialized = false;
  if (initialized) return;

  lv_style_init(&g_style_nfc_icon);
  lv_style_set_text_color(&g_style_nfc_icon,
                           lv_color_hex(theme::kColorTeal));
  lv_style_set_text_font(&g_style_nfc_icon, &material_symbols_24);

  lv_style_init(&g_style_title);
  lv_style_set_text_color(&g_style_title, lv_color_hex(theme::kColorText));
  lv_style_set_text_font(&g_style_title, &roboto_24);

  lv_style_init(&g_style_instruction);
  lv_style_set_text_color(&g_style_instruction,
                           lv_color_hex(theme::kColorMuted));
  lv_style_set_text_font(&g_style_instruction, &roboto_12);

  initialized = true;
}

}  // namespace

MainScreen::MainScreen(ActionCallback action_callback)
    : Screen("Main"), action_callback_(std::move(action_callback)) {}

pw::Status MainScreen::OnActivate() {
  lv_screen_ = lv_obj_create(nullptr);
  if (!lv_screen_) {
    return pw::Status::Internal();
  }

  lv_group_ = lv_group_create();
  EnsureStylesInit();

  lv_obj_set_style_bg_color(
      lv_screen_, lv_color_hex(theme::kColorBg), LV_PART_MAIN);

  // NFC tap icon using Material Symbols Rounded (U+E1BB nfc)
  nfc_icon_ = lv_label_create(lv_screen_);
  lv_label_set_text(nfc_icon_, "\xEE\x86\xBB");
  lv_obj_add_style(nfc_icon_, &g_style_nfc_icon, LV_PART_MAIN);
  lv_obj_align(nfc_icon_, LV_ALIGN_CENTER, 0, -30);

  // Main prompt
  title_label_ = lv_label_create(lv_screen_);
  lv_label_set_text(title_label_, "Mit Badge anmelden");
  lv_obj_add_style(title_label_, &g_style_title, LV_PART_MAIN);
  lv_obj_align(title_label_, LV_ALIGN_CENTER, 0, 10);

  // Instruction text
  instruction_label_ = lv_label_create(lv_screen_);
  lv_label_set_text(instruction_label_, "Badge an Leser halten");
  lv_obj_add_style(instruction_label_, &g_style_instruction, LV_PART_MAIN);
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
