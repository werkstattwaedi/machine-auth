// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include "maco_firmware/modules/display/touch_button_driver.h"

namespace maco::display {

// Capacitive touch input driver for Pico-ResTouch-LCD-2.8
// Reads touch buttons from the hardware
class CapTouchInputDriver : public TouchButtonDriver {
 public:
  CapTouchInputDriver() = default;
  ~CapTouchInputDriver() override = default;

  pw::Status Init() override;
  pw::Result<lv_indev_t*> CreateLvglInputDevice() override;

 private:
  static void ReadCallback(lv_indev_t* indev, lv_indev_data_t* data);

  lv_indev_t* indev_ = nullptr;
};

}  // namespace maco::display
