// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include "maco_firmware/devices/cap_touch/cap1296.h"
#include "maco_firmware/modules/display/touch_button_driver.h"
#include "pw_i2c/initiator.h"

namespace maco::display {

// Capacitive touch input driver using CAP1296 over I2C.
// Provides LVGL KEYPAD input with 4 buttons mapped to navigation keys.
class CapTouchInputDriver : public TouchButtonDriver {
 public:
  explicit CapTouchInputDriver(pw::i2c::Initiator& i2c);
  ~CapTouchInputDriver() override = default;

  pw::Status Init() override;
  pw::Result<lv_indev_t*> CreateLvglInputDevice() override;

  uint8_t Touched() override { return cap1296_.Touched(); }

 private:
  static void ReadCallback(lv_indev_t* indev, lv_indev_data_t* data);

  Cap1296 cap1296_;
  lv_indev_t* indev_ = nullptr;
  uint32_t last_key_ = 0;
};

}  // namespace maco::display
