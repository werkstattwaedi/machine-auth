// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include "lvgl.h"
#include "maco_firmware/modules/ui/button_spec.h"
#include "maco_firmware/modules/ui/data_binding.h"

namespace maco::ui {

/// Button bar displayed at the bottom of the screen.
///
/// Shows labels for bottom row physical buttons (Cancel/OK).
/// Top row buttons (Up/Down) have engraved icons - no on-screen display.
///
/// Lives on lv_layer_top() and persists across screen transitions.
/// Screen provides ButtonConfig via GetButtonConfig().
class ButtonBar {
 public:
  static constexpr int kHeight = 50;

  /// Create button bar on the given parent (typically lv_layer_top()).
  explicit ButtonBar(lv_obj_t* parent);
  ~ButtonBar();

  // Non-copyable, non-movable
  ButtonBar(const ButtonBar&) = delete;
  ButtonBar& operator=(const ButtonBar&) = delete;

  /// Set button configuration from current screen.
  void SetConfig(const ButtonConfig& config);

  /// Update LVGL widgets if config changed.
  /// Called once per frame.
  void Update();

 private:
  lv_obj_t* container_ = nullptr;
  lv_obj_t* cancel_label_ = nullptr;  // Bottom-left
  lv_obj_t* ok_label_ = nullptr;      // Bottom-right

  Watched<ButtonConfig> config_{{}};
};

// Equality operator for ButtonConfig (needed by Watched<T>)
inline bool operator==(const ButtonSpec& a, const ButtonSpec& b) {
  return a.label == b.label && a.led_color == b.led_color;
}

inline bool operator!=(const ButtonSpec& a, const ButtonSpec& b) {
  return !(a == b);
}

inline bool operator==(const ButtonConfig& a, const ButtonConfig& b) {
  return a.cancel == b.cancel && a.ok == b.ok;
}

inline bool operator!=(const ButtonConfig& a, const ButtonConfig& b) {
  return !(a == b);
}

}  // namespace maco::ui
