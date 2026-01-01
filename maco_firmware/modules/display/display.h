// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <atomic>
#include <cstdint>

#include "lvgl.h"
#include "maco_firmware/modules/display/display_driver.h"
#include "maco_firmware/modules/display/touch_button_driver.h"
#include "pw_status/status.h"

namespace maco::display {

// Display manager - owns LVGL lifecycle and render thread
// Usage:
//   auto& display_driver = maco::system::GetDisplayDriver();
//   auto& touch_driver = maco::system::GetTouchButtonDriver();
//   static maco::display::Display display;
//   display.Init(display_driver, touch_driver);
class Display {
 public:
  Display() = default;
  ~Display() = default;

  // Non-copyable, non-movable
  Display(const Display&) = delete;
  Display& operator=(const Display&) = delete;

  // Initialize the display system
  // - Initializes LVGL
  // - Initializes display driver and creates LVGL display
  // - Initializes touch driver and creates LVGL input device
  // - Starts the render thread
  pw::Status Init(DisplayDriver& display_driver,
                  TouchButtonDriver& touch_button_driver);

  // Check if display is initialized and running
  bool is_running() const { return running_.load(); }

  // Get display dimensions (from driver)
  uint16_t width() const { return display_driver_->width(); }
  uint16_t height() const { return display_driver_->height(); }

 private:
  void RenderThread();

  DisplayDriver* display_driver_ = nullptr;
  TouchButtonDriver* touch_button_driver_ = nullptr;
  lv_display_t* lv_display_ = nullptr;
  lv_indev_t* lv_indev_ = nullptr;
  std::atomic<bool> running_{false};
};

}  // namespace maco::display
