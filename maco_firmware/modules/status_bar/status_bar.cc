// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/modules/status_bar/status_bar.h"

#include "maco_firmware/modules/time/zurich_timezone.h"
#include "pw_log/log.h"
#include "pw_string/string_builder.h"

namespace maco::status_bar {

namespace {

const char* WifiIcon(app_state::WifiState state) {
  switch (state) {
    case app_state::WifiState::kConnected:
      return LV_SYMBOL_WIFI;
    case app_state::WifiState::kConnecting:
      return "...";
    case app_state::WifiState::kDisconnected:
      return LV_SYMBOL_WARNING;
  }
  return "?";
}

const char* CloudIcon(app_state::CloudState state) {
  switch (state) {
    case app_state::CloudState::kConnected:
      return LV_SYMBOL_OK;
    case app_state::CloudState::kConnecting:
      return "...";
    case app_state::CloudState::kDisconnected:
      return LV_SYMBOL_CLOSE;
  }
  return "?";
}

}  // namespace

StatusBar::StatusBar(app_state::SystemState& system_state)
    : system_state_(system_state) {}

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
  lv_obj_clear_flag(container_, LV_OBJ_FLAG_SCROLLABLE);
  lv_obj_set_style_bg_color(container_, lv_color_hex(0x2196F3), LV_PART_MAIN);
  lv_obj_set_style_radius(container_, 0, LV_PART_MAIN);
  lv_obj_set_style_border_width(container_, 0, LV_PART_MAIN);
  lv_obj_set_style_pad_all(container_, 8, LV_PART_MAIN);
  lv_obj_set_flex_flow(container_, LV_FLEX_FLOW_ROW);
  lv_obj_set_flex_align(container_, LV_FLEX_ALIGN_SPACE_BETWEEN,
                        LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);

  // Title label (left)
  title_label_ = lv_label_create(container_);
  lv_label_set_text(title_label_, "MACO");
  lv_obj_set_style_text_color(title_label_, lv_color_white(), LV_PART_MAIN);

  // Connectivity status icons (center)
  status_label_ = lv_label_create(container_);
  lv_label_set_text(status_label_, "");
  lv_obj_set_style_text_color(status_label_, lv_color_white(), LV_PART_MAIN);

  // Time label (right)
  time_label_ = lv_label_create(container_);
  lv_label_set_text(time_label_, "--:--");
  lv_obj_set_style_text_color(time_label_, lv_color_white(), LV_PART_MAIN);

  PW_LOG_INFO("StatusBar initialized");
  return pw::OkStatus();
}

void StatusBar::Update() {
  if (!container_) return;

  app_state::SystemStateSnapshot snapshot;
  system_state_.GetSnapshot(snapshot);

  // Update connectivity icons
  pw::StringBuffer<32> status_buf;
  status_buf << WifiIcon(snapshot.wifi_state) << "  "
             << CloudIcon(snapshot.cloud_state) << "  "
             << (snapshot.gateway_connected ? LV_SYMBOL_OK : LV_SYMBOL_CLOSE);
  lv_label_set_text(status_label_, status_buf.c_str());

  // Update time display
  if (snapshot.time_synced) {
    using namespace std::chrono;
    auto utc_secs = duration_cast<seconds>(
        snapshot.wall_clock.time_since_epoch()).count();
    std::time_t local = maco::time::ZurichLocalTime(
        static_cast<std::time_t>(utc_secs));
    int day_seconds = static_cast<int>(((local % 86400) + 86400) % 86400);
    int hours = day_seconds / 3600;
    int minutes = (day_seconds % 3600) / 60;
    pw::StringBuffer<8> time_buf;
    time_buf.Format("%02d:%02d", hours, minutes);
    lv_label_set_text(time_label_, time_buf.c_str());
  } else {
    lv_label_set_text(time_label_, "--:--");
  }

  // Update title based on boot state
  if (snapshot.boot_state == app_state::BootState::kBooting) {
    lv_label_set_text(title_label_, "MACO...");
  } else {
    lv_label_set_text(title_label_, "MACO");
  }
}

}  // namespace maco::status_bar
