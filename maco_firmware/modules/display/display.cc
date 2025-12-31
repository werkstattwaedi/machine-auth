// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/modules/display/display.h"

#include <chrono>
#include <thread>

#include "pw_chrono/system_clock.h"
#include "pw_log/log.h"
#include "pw_thread/detached_thread.h"

namespace maco::display {
namespace {

// LVGL tick callback using pw_chrono::SystemClock
uint32_t GetMillisSinceBoot() {
  auto now = pw::chrono::SystemClock::now();
  return std::chrono::duration_cast<std::chrono::milliseconds>(
             now.time_since_epoch()
  )
      .count();
}

}  // namespace

pw::Status Display::Init(
    DisplayDriver& display_driver,
    TouchButtonDriver& touch_button_driver,
    const DisplayConfig& config
) {
  if (running_.load()) {
    PW_LOG_WARN("Display already initialized");
    return pw::Status::FailedPrecondition();
  }

  display_driver_ = &display_driver;
  touch_button_driver_ = &touch_button_driver;
  width_ = config.width;
  height_ = config.height;

  // Initialize LVGL
  lv_init();
  lv_tick_set_cb(GetMillisSinceBoot);
  PW_LOG_INFO("LVGL initialized");

  // Initialize display driver
  pw::Status status = display_driver_->Init(width_, height_);
  if (!status.ok()) {
    PW_LOG_ERROR("Display driver init failed");
    return status;
  }

  // Create LVGL display
  pw::Result<lv_display_t*> display_result =
      display_driver_->CreateLvglDisplay();
  if (!display_result.ok()) {
    PW_LOG_ERROR("Failed to create LVGL display");
    return display_result.status();
  }
  lv_display_ = *display_result;
  PW_LOG_INFO("LVGL display created (%dx%d)", width_, height_);

  // Initialize touch button driver
  status = touch_button_driver_->Init();
  if (!status.ok()) {
    PW_LOG_WARN("Touch button driver init failed (continuing without input)");
    // Continue without input - not fatal
  } else {
    // Create LVGL input device
    pw::Result<lv_indev_t*> indev_result =
        touch_button_driver_->CreateLvglInputDevice();
    if (!indev_result.ok()) {
      PW_LOG_WARN("Failed to create LVGL input device");
    } else {
      lv_indev_ = *indev_result;
      PW_LOG_INFO("LVGL input device created");
    }
  }

  // Start render thread
  running_.store(true);
  pw::thread::DetachedThread(pw::thread::stl::Options(), [this]() {
    RenderThread();
  });
  PW_LOG_INFO("Render thread started");

  return pw::OkStatus();
}

void Display::RenderThread() {
  while (running_.load()) {
    uint32_t time_till_next = lv_timer_handler();
    std::this_thread::sleep_for(std::chrono::milliseconds(time_till_next));
  }
}

}  // namespace maco::display
