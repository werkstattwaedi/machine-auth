// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/modules/status_bar/status_icon.h"

#include "pw_assert/check.h"

namespace maco::status_bar {

namespace {

// Shared style for all icon labels: white text with the Material Symbols font.
// Initialized once on first StatusIcon::Init() call (requires LVGL running).
lv_style_t g_icon_style;

void EnsureIconStyleInit() {
  static bool initialized = false;
  if (initialized) return;
  lv_style_init(&g_icon_style);
  lv_style_set_text_color(&g_icon_style, lv_color_white());
  lv_style_set_text_font(&g_icon_style, &material_symbols_24);
  initialized = true;
}

}  // namespace

StatusIcon::~StatusIcon() {
  StopAnimation();
  // label_ is a child of StatusBar's container. C++ destroys members in
  // reverse declaration order, so StatusIcon members are destroyed before
  // StatusBar::~StatusBar() calls lv_obj_delete(container_). The container
  // deletion then cleans up the label — we must not delete it here.
  label_ = nullptr;
}

void StatusIcon::Init(lv_obj_t* parent) {
  PW_CHECK_NOTNULL(parent);
  EnsureIconStyleInit();
  label_ = lv_label_create(parent);
  lv_label_set_text(label_, "");
  lv_obj_add_style(label_, &g_icon_style, LV_PART_MAIN);
}

void StatusIcon::SetIcon(const char* utf8_icon) {
  StopAnimation();
  if (label_) {
    lv_label_set_text(label_, utf8_icon);
  }
}

void StatusIcon::SetAnimation(pw::span<const char* const> frames,
                               uint32_t interval_ms) {
  StopAnimation();
  if (frames.empty() || !label_) return;
  frames_ = frames;
  frame_index_ = 0;
  lv_label_set_text(label_, frames_[0]);
  timer_ = lv_timer_create(OnTimer, interval_ms, this);
}

void StatusIcon::StopAnimation() {
  if (timer_) {
    lv_timer_delete(timer_);
    timer_ = nullptr;
  }
  frames_ = {};
  frame_index_ = 0;
}

// static
void StatusIcon::OnTimer(lv_timer_t* timer) {
  auto* self = static_cast<StatusIcon*>(lv_timer_get_user_data(timer));
  self->frame_index_ = (self->frame_index_ + 1) % self->frames_.size();
  lv_label_set_text(self->label_, self->frames_[self->frame_index_]);
}

void StatusIcon::SetColor(lv_color_t color) {
  if (label_) {
    lv_obj_set_style_text_color(label_, color, LV_PART_MAIN);
  }
}

}  // namespace maco::status_bar
