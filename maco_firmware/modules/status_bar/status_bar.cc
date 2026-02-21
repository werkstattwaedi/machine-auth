// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/modules/status_bar/status_bar.h"

#include "maco_firmware/modules/terminal_ui/theme.h"
#include "pw_log/log.h"

namespace maco::status_bar {

namespace {

// Material Symbols Rounded UTF-8 sequences
constexpr const char kIconWifi1Bar[] = "\xEE\x93\x8A";   // U+E4CA wifi_1_bar
constexpr const char kIconWifi2Bar[] = "\xEE\x93\x99";   // U+E4D9 wifi_2_bar
constexpr const char kIconWifi[] = "\xEE\x98\xBE";       // U+E63E wifi
constexpr const char kIconWifiOff[] = "\xEE\x99\x88";    // U+E648 wifi_off

// Frames for the wifi connecting animation (500ms per step).
constexpr const char* kWifiConnectingFrames[] = {
    kIconWifi1Bar, kIconWifi2Bar, kIconWifi};

}  // namespace

StatusBar::StatusBar(app_state::SystemState& system_state)
    : system_state_(system_state) {}

StatusBar::~StatusBar() {
  // wifi_icon_ is destroyed first (reverse declaration order),
  // stopping its lv_timer before lv_obj_delete(container_) cleans up labels.
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
  lv_obj_clear_flag(container_, LV_OBJ_FLAG_SCROLLABLE);
  lv_obj_set_style_bg_color(container_, lv_color_hex(0xE0E0E0), LV_PART_MAIN);
  lv_obj_set_style_bg_opa(container_, LV_OPA_COVER, LV_PART_MAIN);
  lv_obj_set_style_radius(container_, 0, LV_PART_MAIN);
  lv_obj_set_style_border_width(container_, 0, LV_PART_MAIN);
  lv_obj_set_style_pad_all(container_, 8, LV_PART_MAIN);
  lv_obj_set_flex_flow(container_, LV_FLEX_FLOW_ROW);
  lv_obj_set_flex_align(container_, LV_FLEX_ALIGN_SPACE_BETWEEN,
                        LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);

  // Time label (left)
  time_label_ = lv_label_create(container_);
  lv_label_set_text(time_label_, "--:--");
  lv_obj_set_style_text_color(time_label_, lv_color_hex(0x212121),
                              LV_PART_MAIN);

  // Wifi icon (right)
  wifi_icon_.Init(container_);

  PW_LOG_INFO("StatusBar initialized");
  return pw::OkStatus();
}

void StatusBar::SetBackgroundColor(uint32_t screen_bg) {
  if (!container_) return;

  uint32_t bar_bg = terminal_ui::theme::DarkenColor(screen_bg);
  lv_obj_set_style_bg_color(container_, lv_color_hex(bar_bg), LV_PART_MAIN);

  // Pick text/icon color based on bar brightness
  lv_color_t text_color = terminal_ui::theme::IsLightColor(bar_bg)
                              ? lv_color_hex(0x212121)
                              : lv_color_white();
  lv_obj_set_style_text_color(time_label_, text_color, LV_PART_MAIN);
  wifi_icon_.SetColor(text_color);
}

void StatusBar::Update() {
  if (!container_) return;

  app_state::SystemStateSnapshot snapshot;
  system_state_.GetSnapshot(snapshot);

  wifi_state_.Set(snapshot.wifi_state);
  if (wifi_state_.CheckAndClearDirty()) {
    UpdateWifiIcon(wifi_state_.Get());
  }

  local_time_.Set(snapshot.local_time);
  if (local_time_.CheckAndClearDirty()) {
    if (auto& lt = local_time_.Get(); lt.has_value()) {
      lv_label_set_text_fmt(time_label_, "%02d:%02d", lt->hour, lt->minute);
    } else {
      lv_label_set_text(time_label_, "--:--");
    }
  }
}

void StatusBar::UpdateWifiIcon(app_state::WifiState state) {
  switch (state) {
    case app_state::WifiState::kConnected:
      wifi_icon_.SetIcon(kIconWifi);
      break;
    case app_state::WifiState::kConnecting:
      wifi_icon_.SetAnimation(kWifiConnectingFrames, 500);
      break;
    case app_state::WifiState::kDisconnected:
      wifi_icon_.SetIcon(kIconWifiOff);
      break;
  }
}

}  // namespace maco::status_bar
