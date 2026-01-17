// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <atomic>
#include <cstdint>

#include "lvgl.h"
#include "maco_firmware/modules/display/display_driver.h"
#include "maco_firmware/modules/display/touch_button_driver.h"
#include "pw_function/function.h"
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
  // Callback invoked once on render thread before main loop starts.
  // Use for LVGL widget creation (StatusBar, AppShell, Screens).
  using InitCallback = pw::Function<void()>;

  // Callback invoked once per frame before lv_timer_handler()
  using UpdateCallback = pw::Function<void()>;

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

  // Set callback invoked once on render thread before main loop starts.
  // Must be called before Init(). Use for LVGL widget creation.
  void SetInitCallback(InitCallback callback) {
    init_callback_ = std::move(callback);
  }

  // Set callback invoked once per frame before LVGL rendering.
  // Used by AppShell to update UI state in sync with rendering.
  void SetUpdateCallback(UpdateCallback callback) {
    update_callback_ = std::move(callback);
  }

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
  InitCallback init_callback_;
  UpdateCallback update_callback_;
};

}  // namespace maco::display
