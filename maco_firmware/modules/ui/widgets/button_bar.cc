// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/modules/ui/widgets/button_bar.h"

namespace maco::ui {

namespace {

constexpr int kPillRadius = 8;
constexpr int kPillOverflow = 8;  // Extends below screen edge
constexpr int kPillPadH = 12;     // Horizontal padding inside pill
constexpr int kPillPadV = 6;      // Vertical padding inside pill

lv_obj_t* CreatePill(lv_obj_t* parent) {
  lv_obj_t* pill = lv_obj_create(parent);
  lv_obj_set_size(pill, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
  lv_obj_set_style_radius(pill, kPillRadius, LV_PART_MAIN);
  lv_obj_set_style_border_width(pill, 0, LV_PART_MAIN);
  lv_obj_set_style_pad_left(pill, kPillPadH, LV_PART_MAIN);
  lv_obj_set_style_pad_right(pill, kPillPadH, LV_PART_MAIN);
  lv_obj_set_style_pad_top(pill, kPillPadV, LV_PART_MAIN);
  lv_obj_set_style_pad_bottom(pill, kPillPadV + kPillOverflow, LV_PART_MAIN);
  lv_obj_clear_flag(pill, LV_OBJ_FLAG_SCROLLABLE);
  return pill;
}

}  // namespace

ButtonBar::ButtonBar(lv_obj_t* parent) {
  // Create container at bottom of parent
  container_ = lv_obj_create(parent);
  lv_obj_set_size(container_, LV_PCT(100), kHeight);
  lv_obj_align(container_, LV_ALIGN_BOTTOM_MID, 0, 0);

  // Style: transparent background, no border
  lv_obj_set_style_bg_opa(container_, LV_OPA_TRANSP, LV_PART_MAIN);
  lv_obj_set_style_border_width(container_, 0, LV_PART_MAIN);
  lv_obj_set_style_pad_left(container_, 8, LV_PART_MAIN);
  lv_obj_set_style_pad_right(container_, 8, LV_PART_MAIN);
  lv_obj_set_style_pad_top(container_, 0, LV_PART_MAIN);
  lv_obj_set_style_pad_bottom(container_, 0, LV_PART_MAIN);

  // OK pill (bottom-left, matching physical ENTER button)
  ok_pill_ = CreatePill(container_);
  lv_obj_align(ok_pill_, LV_ALIGN_BOTTOM_LEFT, 0, kPillOverflow);
  ok_label_ = lv_label_create(ok_pill_);
  lv_obj_center(ok_label_);

  // Cancel pill (bottom-right, matching physical ESC button)
  cancel_pill_ = CreatePill(container_);
  lv_obj_align(cancel_pill_, LV_ALIGN_BOTTOM_RIGHT, 0, kPillOverflow);
  cancel_label_ = lv_label_create(cancel_pill_);
  lv_obj_center(cancel_label_);
}

ButtonBar::~ButtonBar() {
  if (container_) {
    lv_obj_delete(container_);
    container_ = nullptr;
  }
}

void ButtonBar::SetConfig(const ButtonConfig& config) { config_.Set(config); }

void ButtonBar::Update() {
  if (!config_.CheckAndClearDirty()) {
    return;
  }

  const auto& config = config_.Get();
  UpdatePill(ok_pill_, ok_label_, config.ok);
  UpdatePill(cancel_pill_, cancel_label_, config.cancel);
}

void ButtonBar::UpdatePill(lv_obj_t* pill, lv_obj_t* label,
                           const ButtonSpec& spec) {
  if (spec.label.empty() || spec.bg_color == 0) {
    lv_obj_add_flag(pill, LV_OBJ_FLAG_HIDDEN);
    return;
  }

  lv_obj_remove_flag(pill, LV_OBJ_FLAG_HIDDEN);

  // Set pill background color
  lv_obj_set_style_bg_color(pill, lv_color_hex(spec.bg_color), LV_PART_MAIN);
  lv_obj_set_style_bg_opa(pill, LV_OPA_COVER, LV_PART_MAIN);

  // Set label text and color
  lv_label_set_text(label, spec.label.data());
  lv_obj_set_style_text_color(label, lv_color_hex(spec.text_color),
                              LV_PART_MAIN);
}

}  // namespace maco::ui
