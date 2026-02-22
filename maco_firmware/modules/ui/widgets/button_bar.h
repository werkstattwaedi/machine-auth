// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include "lvgl.h"
#include "maco_firmware/modules/ui/button_spec.h"
#include "maco_firmware/modules/ui/data_binding.h"

namespace maco::ui {

/// Button bar displayed at the bottom of the screen.
///
/// Shows colored pill buttons for bottom row physical buttons (OK/Cancel).
/// OK pill at bottom-left (matching physical ENTER key).
/// Cancel pill at bottom-right (matching physical ESC key).
/// Pills extend below the screen edge so only top corners appear rounded.
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
  void UpdatePill(lv_obj_t* pill, lv_obj_t* label, const ButtonSpec& spec);

  lv_obj_t* container_ = nullptr;
  lv_obj_t* ok_pill_ = nullptr;       // Bottom-left pill
  lv_obj_t* ok_label_ = nullptr;
  lv_obj_t* cancel_pill_ = nullptr;   // Bottom-right pill
  lv_obj_t* cancel_label_ = nullptr;

  Watched<ButtonConfig> config_{{}};
};

// Equality operators for ButtonConfig (needed by Watched<T>)
inline bool operator==(const ButtonSpec& a, const ButtonSpec& b) {
  return a.label == b.label && a.led_color == b.led_color &&
         a.bg_color == b.bg_color && a.text_color == b.text_color;
}

inline bool operator!=(const ButtonSpec& a, const ButtonSpec& b) {
  return !(a == b);
}

inline bool operator==(const ButtonConfig& a, const ButtonConfig& b) {
  return a.ok == b.ok && a.cancel == b.cancel;
}

inline bool operator!=(const ButtonConfig& a, const ButtonConfig& b) {
  return !(a == b);
}

}  // namespace maco::ui
