// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/modules/terminal_ui/screens/menu_screen.h"

#include "lvgl.h"
#include "maco_firmware/modules/terminal_ui/theme.h"
#include "pw_log/log.h"

namespace maco::terminal_ui {

MenuScreen::MenuScreen(pw::span<const MenuItem> items,
                       ActionCallback action_callback)
    : Screen("Menu"), action_callback_(std::move(action_callback)) {
  for (const auto& item : items) {
    items_.push_back(item);
  }
}

pw::Status MenuScreen::OnActivate() {
  lv_screen_ = lv_obj_create(nullptr);
  if (!lv_screen_) {
    return pw::Status::Internal();
  }

  lv_group_ = lv_group_create();

  // White background
  lv_obj_set_style_bg_color(
      lv_screen_, lv_color_hex(theme::kColorWhiteBg), LV_PART_MAIN);

  // List container (no title — matches mockup)
  list_ = lv_list_create(lv_screen_);
  lv_obj_set_size(list_, 220, 200);
  lv_obj_align(list_, LV_ALIGN_CENTER, 0, 0);
  lv_obj_set_style_bg_color(
      list_, lv_color_hex(theme::kColorWhiteBg), LV_PART_MAIN);
  lv_obj_set_style_border_width(list_, 0, LV_PART_MAIN);
  lv_obj_set_style_pad_row(list_, 4, LV_PART_MAIN);

  // Create list items
  for (size_t i = 0; i < items_.size(); i++) {
    lv_obj_t* btn = lv_list_add_button(list_, nullptr, items_[i].label.data());

    // Item styling: light background, dark text, subtle border
    lv_obj_set_style_bg_color(
        btn, lv_color_hex(theme::kColorWhiteBg), LV_PART_MAIN);
    lv_obj_set_style_bg_opa(btn, LV_OPA_COVER, LV_PART_MAIN);
    lv_obj_set_style_text_color(
        btn, lv_color_hex(theme::kColorDarkText), LV_PART_MAIN);
    lv_obj_set_style_text_font(btn, &roboto_12, LV_PART_MAIN);
    lv_obj_set_style_border_color(
        btn, lv_color_hex(theme::kColorLightGray), LV_PART_MAIN);
    lv_obj_set_style_border_width(btn, theme::kBorderWidth, LV_PART_MAIN);
    lv_obj_set_style_radius(btn, theme::kRadius, LV_PART_MAIN);
    lv_obj_set_style_pad_all(btn, theme::kPadding, LV_PART_MAIN);

    // Focus styling: blue background, white text
    lv_obj_set_style_bg_color(
        btn, lv_color_hex(theme::kColorBlue), LV_STATE_FOCUSED);
    lv_obj_set_style_text_color(
        btn, lv_color_white(), LV_STATE_FOCUSED);
    lv_obj_set_style_border_width(btn, 0, LV_STATE_FOCUSED);

    // Store item index in user data for click handler
    lv_obj_set_user_data(btn, reinterpret_cast<void*>(i));

    // Click handler
    lv_obj_add_event_cb(
        btn,
        [](lv_event_t* e) {
          auto* self = static_cast<MenuScreen*>(lv_event_get_user_data(e));
          auto* target = static_cast<lv_obj_t*>(lv_event_get_target_obj(e));
          auto idx = reinterpret_cast<uintptr_t>(lv_obj_get_user_data(target));
          if (self && idx < self->items_.size() && self->action_callback_) {
            self->action_callback_(self->items_[idx].action);
          }
        },
        LV_EVENT_CLICKED,
        this);

    AddToGroup(btn);
  }

  PW_LOG_INFO("MenuScreen activated with %u items",
              static_cast<unsigned>(items_.size()));
  return pw::OkStatus();
}

void MenuScreen::OnDeactivate() {
  if (lv_group_) {
    lv_group_delete(lv_group_);
    lv_group_ = nullptr;
  }
  lv_screen_ = nullptr;
  list_ = nullptr;
  PW_LOG_INFO("MenuScreen deactivated");
}

ui::ButtonConfig MenuScreen::GetButtonConfig() const {
  return {
      .ok = {.label = "Wählen",
             .led_color = theme::kColorBtnGreen,
             .bg_color = theme::kColorBtnGreen,
             .text_color = 0xFFFFFF},
      .cancel = {.label = "Zurück",
                 .led_color = theme::kColorYellow,
                 .bg_color = theme::kColorYellow,
                 .text_color = theme::kColorDarkText},
  };
}

ui::ScreenStyle MenuScreen::GetScreenStyle() const {
  return {.bg_color = theme::kColorWhiteBg};
}

}  // namespace maco::terminal_ui
