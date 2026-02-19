// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include "lvgl.h"
#include "maco_firmware/modules/app_state/system_state.h"
#include "maco_firmware/modules/status_bar/status_icon.h"
#include "pw_status/status.h"

namespace maco::status_bar {

/// Status bar displayed at the top of the screen.
///
/// Lives on lv_layer_top() and persists across screen transitions.
/// Displays system connectivity state (WiFi, Cloud, Gateway) and time.
class StatusBar {
 public:
  static constexpr int kHeight = 40;

  explicit StatusBar(app_state::SystemState& system_state);
  ~StatusBar();

  // Non-copyable, non-movable
  StatusBar(const StatusBar&) = delete;
  StatusBar& operator=(const StatusBar&) = delete;

  /// Initialize and create LVGL widgets on lv_layer_top().
  pw::Status Init();

  /// Update display from system state.
  /// Called once per frame.
  void Update();

 private:
  void UpdateWifiIcon(app_state::WifiState state);
  void UpdateCloudIcon(app_state::CloudState cloud_state,
                       bool gateway_connected);

  app_state::SystemState& system_state_;

  // LVGL objects — container_ must be declared before StatusIcon members so
  // that C++ destroys the icons (stopping their timers) before ~StatusBar()
  // calls lv_obj_delete(container_).
  lv_obj_t* container_ = nullptr;
  lv_obj_t* title_label_ = nullptr;
  lv_obj_t* icons_container_ = nullptr;
  lv_obj_t* time_label_ = nullptr;

  // Icon state — declared after container_ (destroyed first, before container)
  StatusIcon wifi_icon_;
  StatusIcon cloud_icon_;

  // Previous connectivity state — used to avoid restarting animations every
  // frame when nothing has changed.
  app_state::WifiState prev_wifi_state_ = app_state::WifiState::kConnected;
  app_state::CloudState prev_cloud_state_ = app_state::CloudState::kConnected;
  bool prev_gateway_connected_ = true;
  bool icons_initialized_ = false;
};

}  // namespace maco::status_bar
