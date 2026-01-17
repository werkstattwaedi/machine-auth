// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include "lvgl.h"
#include "pw_status/status.h"

namespace maco::status_bar {

/// Status bar displayed at the top of the screen.
///
/// Lives on lv_layer_top() and persists across screen transitions.
/// Content will be driven by a system state FSM (to be defined).
///
/// Placeholder implementation - shows a simple bar at the top.
class StatusBar {
 public:
  static constexpr int kHeight = 40;

  StatusBar() = default;
  ~StatusBar();

  // Non-copyable, non-movable
  StatusBar(const StatusBar&) = delete;
  StatusBar& operator=(const StatusBar&) = delete;

  /// Initialize and create LVGL widgets on lv_layer_top().
  pw::Status Init();

  /// Update display from observed state.
  /// Called once per frame.
  void Update();

 private:
  lv_obj_t* container_ = nullptr;
  lv_obj_t* title_label_ = nullptr;
};

}  // namespace maco::status_bar
