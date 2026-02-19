// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include "lvgl.h"
#include "maco_firmware/modules/app_state/system_state.h"
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
  app_state::SystemState& system_state_;

  lv_obj_t* container_ = nullptr;
  lv_obj_t* title_label_ = nullptr;
  lv_obj_t* status_label_ = nullptr;
  lv_obj_t* time_label_ = nullptr;
};

}  // namespace maco::status_bar
