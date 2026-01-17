// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/modules/status_bar/status_bar.h"

#include "pw_log/log.h"

namespace maco::status_bar {

StatusBar::~StatusBar() {
  if (container_) {
    lv_obj_delete(container_);
    container_ = nullptr;
  }
}

pw::Status StatusBar::Init() {
  // Create container on top layer (persistent across screens)
  container_ = lv_obj_create(lv_layer_top());
  if (!container_) {
    PW_LOG_ERROR("Failed to create status bar container");
    return pw::Status::Internal();
  }

  // Style: full width, fixed height at top
  lv_obj_set_size(container_, LV_PCT(100), kHeight);
  lv_obj_set_pos(container_, 0, 0);
  lv_obj_set_style_bg_color(container_, lv_color_hex(0x2196F3), LV_PART_MAIN);
  lv_obj_set_style_radius(container_, 0, LV_PART_MAIN);
  lv_obj_set_style_border_width(container_, 0, LV_PART_MAIN);
  lv_obj_set_style_pad_all(container_, 8, LV_PART_MAIN);

  // Placeholder title label
  title_label_ = lv_label_create(container_);
  lv_label_set_text(title_label_, "MACO");
  lv_obj_set_style_text_color(title_label_, lv_color_white(), LV_PART_MAIN);
  lv_obj_center(title_label_);

  PW_LOG_INFO("StatusBar initialized");
  return pw::OkStatus();
}

void StatusBar::Update() {
  // Placeholder - will observe FSM state later
  // For now, nothing to update dynamically
}

}  // namespace maco::status_bar
