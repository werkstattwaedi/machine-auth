// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/modules/status_bar/status_bar.h"

#include "pw_log/log.h"

namespace maco::status_bar {

namespace {

// Shared style for status bar text labels (title, time): white Roboto text.
// Initialized once on first StatusBar::Init() call (requires LVGL running).
lv_style_t g_text_style;

void EnsureTextStyleInit() {
  static bool initialized = false;
  if (initialized) return;
  lv_style_init(&g_text_style);
  lv_style_set_text_color(&g_text_style, lv_color_white());
  initialized = true;
}

// Material Symbols Rounded UTF-8 sequences
constexpr const char kIconCloudDone[] = "\xEE\x8A\xBF";  // U+E2BF cloud_done
constexpr const char kIconCloudOff[] = "\xEE\x8B\x81";   // U+E2C1 cloud_off
constexpr const char kIconWifi1Bar[] = "\xEE\x93\x8A";   // U+E4CA wifi_1_bar
constexpr const char kIconWifi2Bar[] = "\xEE\x93\x99";   // U+E4D9 wifi_2_bar
constexpr const char kIconWifi[] = "\xEE\x98\xBE";       // U+E63E wifi
constexpr const char kIconWifiOff[] = "\xEE\x99\x88";    // U+E648 wifi_off
constexpr const char kIconCloud[] = "\xEF\x85\x9C";      // U+F15C cloud

// Frames for the wifi connecting animation (500ms per step).
constexpr const char* kWifiConnectingFrames[] = {
    kIconWifi1Bar, kIconWifi2Bar, kIconWifi};

}  // namespace

StatusBar::StatusBar(app_state::SystemState& system_state)
    : system_state_(system_state) {}

StatusBar::~StatusBar() {
  // wifi_icon_ and cloud_icon_ are destroyed first (reverse declaration order),
  // stopping their lv_timers before lv_obj_delete(container_) cleans up labels.
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

  EnsureTextStyleInit();

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
  lv_obj_add_style(title_label_, &g_text_style, LV_PART_MAIN);

  // Icon cluster (center) — flex row keeps wifi and cloud visually adjacent
  icons_container_ = lv_obj_create(container_);
  lv_obj_remove_style_all(icons_container_);
  lv_obj_set_size(icons_container_, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
  lv_obj_set_flex_flow(icons_container_, LV_FLEX_FLOW_ROW);
  lv_obj_set_flex_align(icons_container_, LV_FLEX_ALIGN_CENTER,
                        LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
  lv_obj_set_style_pad_column(icons_container_, 4, LV_PART_MAIN);

  wifi_icon_.Init(icons_container_);
  cloud_icon_.Init(icons_container_);

  // Time label (right)
  time_label_ = lv_label_create(container_);
  lv_label_set_text(time_label_, "--:--");
  lv_obj_add_style(time_label_, &g_text_style, LV_PART_MAIN);

  PW_LOG_INFO("StatusBar initialized");
  return pw::OkStatus();
}

void StatusBar::Update() {
  if (!container_) return;

  app_state::SystemStateSnapshot snapshot;
  system_state_.GetSnapshot(snapshot);

  // Update icons only when state changes (avoids restarting animation timers).
  if (!icons_initialized_ || snapshot.wifi_state != prev_wifi_state_) {
    prev_wifi_state_ = snapshot.wifi_state;
    UpdateWifiIcon(snapshot.wifi_state);
  }

  bool cloud_changed = snapshot.cloud_state != prev_cloud_state_ ||
                       snapshot.gateway_connected != prev_gateway_connected_;
  if (!icons_initialized_ || cloud_changed) {
    prev_cloud_state_ = snapshot.cloud_state;
    prev_gateway_connected_ = snapshot.gateway_connected;
    UpdateCloudIcon(snapshot.cloud_state, snapshot.gateway_connected);
  }

  icons_initialized_ = true;

  // Update time display
  if (snapshot.time_synced) {
    using namespace std::chrono;
    auto epoch_secs =
        duration_cast<seconds>(snapshot.wall_clock.time_since_epoch());
    auto local_secs = epoch_secs.count() + snapshot.utc_offset_seconds;
    int day_seconds =
        static_cast<int>(((local_secs % 86400) + 86400) % 86400);
    int hours = day_seconds / 3600;
    int minutes = (day_seconds % 3600) / 60;
    lv_label_set_text_fmt(time_label_, "%02d:%02d", hours, minutes);
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

void StatusBar::UpdateCloudIcon(app_state::CloudState cloud_state,
                                 bool gateway_connected) {
  switch (cloud_state) {
    case app_state::CloudState::kConnected:
      cloud_icon_.SetIcon(gateway_connected ? kIconCloudDone : kIconCloud);
      break;
    case app_state::CloudState::kConnecting:
      cloud_icon_.SetIcon(kIconCloud);
      break;
    case app_state::CloudState::kDisconnected:
      cloud_icon_.SetIcon(kIconCloudOff);
      break;
  }
}

}  // namespace maco::status_bar
