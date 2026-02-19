// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <cstddef>

#include "lvgl.h"
#include "pw_span/span.h"

namespace maco::status_bar {

/// Single Material Symbol icon label for the status bar.
///
/// Supports static icons and animated icons that cycle through a set of frames
/// at a fixed wall-clock interval (driven by lv_timer, not frame count).
///
/// Lifecycle note: the LVGL label is a child of the parent passed to Init().
/// The parent container owns label deletion; this class only manages the timer.
class StatusIcon {
 public:
  StatusIcon() = default;
  ~StatusIcon();

  StatusIcon(const StatusIcon&) = delete;
  StatusIcon& operator=(const StatusIcon&) = delete;

  /// Create the LVGL label as a child of parent. Must be called before use.
  void Init(lv_obj_t* parent);

  /// Show a static icon (stops any running animation).
  void SetIcon(const char* utf8_icon);

  /// Cycle through frames, advancing every interval_ms milliseconds.
  /// The frames span must outlive the animation.
  void SetAnimation(pw::span<const char* const> frames, uint32_t interval_ms);

 private:
  void StopAnimation();
  static void OnTimer(lv_timer_t* timer);

  lv_obj_t* label_ = nullptr;
  lv_timer_t* timer_ = nullptr;
  pw::span<const char* const> frames_;
  size_t frame_index_ = 0;
};

}  // namespace maco::status_bar
