// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/modules/ui/widgets/button_bar.h"

namespace maco::ui {

ButtonBar::ButtonBar(lv_obj_t* parent) {
  // Create container at bottom of parent
  container_ = lv_obj_create(parent);
  lv_obj_set_size(container_, LV_PCT(100), kHeight);
  lv_obj_align(container_, LV_ALIGN_BOTTOM_MID, 0, 0);

  // Style: transparent background, no border
  lv_obj_set_style_bg_opa(container_, LV_OPA_TRANSP, LV_PART_MAIN);
  lv_obj_set_style_border_width(container_, 0, LV_PART_MAIN);
  lv_obj_set_style_pad_all(container_, 8, LV_PART_MAIN);

  // Cancel label (bottom-left)
  cancel_label_ = lv_label_create(container_);
  lv_obj_align(cancel_label_, LV_ALIGN_BOTTOM_LEFT, 0, 0);
  lv_obj_set_style_text_color(cancel_label_, lv_color_white(), LV_PART_MAIN);
  lv_label_set_text(cancel_label_, "");

  // OK label (bottom-right)
  ok_label_ = lv_label_create(container_);
  lv_obj_align(ok_label_, LV_ALIGN_BOTTOM_RIGHT, 0, 0);
  lv_obj_set_style_text_color(ok_label_, lv_color_white(), LV_PART_MAIN);
  lv_label_set_text(ok_label_, "");
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

  // Update cancel label
  if (config.cancel.label.empty()) {
    lv_obj_add_flag(cancel_label_, LV_OBJ_FLAG_HIDDEN);
  } else {
    lv_obj_remove_flag(cancel_label_, LV_OBJ_FLAG_HIDDEN);
    lv_label_set_text(cancel_label_, config.cancel.label.data());
  }

  // Update OK label
  if (config.ok.label.empty()) {
    lv_obj_add_flag(ok_label_, LV_OBJ_FLAG_HIDDEN);
  } else {
    lv_obj_remove_flag(ok_label_, LV_OBJ_FLAG_HIDDEN);
    lv_label_set_text(ok_label_, config.ok.label.data());
  }

  // TODO: Update button LED colors via system interface
}

}  // namespace maco::ui
