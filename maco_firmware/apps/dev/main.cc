// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#define PW_LOG_MODULE_NAME "MAIN"

#include "lvgl.h"
#include "maco_firmware/modules/display/display.h"
#include "maco_firmware/system/system.h"
#include "pw_log/log.h"

namespace {

void AppInit() {
  PW_LOG_INFO("MACO Dev Firmware initializing...");

  // Initialize display module (handles LVGL init, drivers, render thread)
  static maco::display::Display display;
  auto& display_driver = maco::system::GetDisplayDriver();
  auto& touch_driver = maco::system::GetTouchButtonDriver();

  auto status = display.Init(display_driver, touch_driver);
  if (!status.ok()) {
    PW_LOG_ERROR("Display init failed");
    return;
  }

  PW_LOG_INFO("Display initialized: %dx%d", display.width(), display.height());

  // Create a simple test label
  lv_obj_t* label = lv_label_create(lv_screen_active());
  lv_label_set_text(label, "MACO Dev");
  lv_obj_center(label);

  PW_LOG_INFO("AppInit complete");
}

}  // namespace

int main() {
  maco::system::Init(AppInit);
  // Init never returns
}
