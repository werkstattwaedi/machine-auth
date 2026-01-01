// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#define PW_LOG_MODULE_NAME "MAIN"

#include "lvgl.h"
#include "maco_firmware/modules/display/display_driver.h"
#include "maco_firmware/system/system.h"
#include "pw_log/log.h"

namespace {

void AppInit() {
  PW_LOG_INFO("MACO Dev Firmware initializing...");

  // Initialize LVGL
  PW_LOG_INFO("Calling lv_init()...");
  lv_init();
  PW_LOG_INFO("lv_init() done");

  // Initialize and create display
  auto& display_driver = maco::system::GetDisplayDriver();
  PW_LOG_INFO("Calling display_driver.Init()...");
  auto status = display_driver.Init();
  if (!status.ok()) {
    PW_LOG_ERROR("Display init failed");
    return;
  }
  PW_LOG_INFO("display_driver.Init() done");

  PW_LOG_INFO("Calling CreateLvglDisplay()...");
  auto display_result = display_driver.CreateLvglDisplay();
  if (!display_result.ok()) {
    PW_LOG_ERROR("Display creation failed");
    return;
  }
  PW_LOG_INFO("CreateLvglDisplay() done");

  PW_LOG_INFO("Display initialized: %dx%d", display_driver.width(),
              display_driver.height());

  // Create a simple test label
  PW_LOG_INFO("Creating test label...");
  lv_obj_t* label = lv_label_create(lv_screen_active());
  lv_label_set_text(label, "MACO Simulator");
  lv_obj_center(label);
  PW_LOG_INFO("AppInit complete");
}

}  // namespace

int main() {
  maco::system::Init(AppInit);
  // Init never returns
}
