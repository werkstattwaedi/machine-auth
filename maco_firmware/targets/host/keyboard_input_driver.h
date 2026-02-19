// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include "maco_firmware/modules/display/touch_button_driver.h"

namespace maco::display {

class SdlDisplayDriver;

// Keyboard and mouse input driver for host simulator.
// Maps keyboard keys and mouse clicks on button regions to LVGL keys.
class KeyboardInputDriver : public TouchButtonDriver {
 public:
  explicit KeyboardInputDriver(SdlDisplayDriver& display);
  ~KeyboardInputDriver() override = default;

  pw::Status Init() override;
  pw::Result<lv_indev_t*> CreateLvglInputDevice() override;

 private:
  static void ReadCallback(lv_indev_t* indev, lv_indev_data_t* data);

  SdlDisplayDriver& display_;
  lv_indev_t* indev_ = nullptr;
  uint32_t last_key_ = 0;
};

}  // namespace maco::display
