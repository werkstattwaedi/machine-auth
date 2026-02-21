// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <cstdint>
#include <optional>

#include "lvgl.h"
#include "maco_firmware/modules/app_state/system_state.h"
#include "maco_firmware/modules/status_bar/status_icon.h"
#include "maco_firmware/modules/time/local_time.h"
#include "maco_firmware/modules/ui/data_binding.h"
#include "pw_status/status.h"

namespace maco::status_bar {

/// Status bar displayed at the top of the screen.
///
/// Lives on lv_layer_top() and persists across screen transitions.
/// Shows time (left) and wifi icon (right). Background color adapts
/// to the current screen's background via SetBackgroundColor().
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

  /// Adapt status bar colors to the current screen background.
  /// Darkens the given color for the bar bg, picks white or dark text.
  void SetBackgroundColor(uint32_t screen_bg);

  /// Update display from system state.
  /// Called once per frame.
  void Update();

 private:
  void UpdateWifiIcon(app_state::WifiState state);

  app_state::SystemState& system_state_;

  // LVGL objects — container_ must be declared before StatusIcon members so
  // that C++ destroys the icons (stopping their timers) before ~StatusBar()
  // calls lv_obj_delete(container_).
  lv_obj_t* container_ = nullptr;
  lv_obj_t* time_label_ = nullptr;

  // Icon state — declared after container_ (destroyed first, before container)
  StatusIcon wifi_icon_;

  // Watched state — only update LVGL widgets when values actually change.
  ui::Watched<app_state::WifiState> wifi_state_{app_state::WifiState::kDisconnected};
  ui::Watched<std::optional<time::LocalTime>> local_time_{std::nullopt};
};

}  // namespace maco::status_bar
