// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include "maco_firmware/modules/display/touch_button_driver.h"

namespace maco::display {

// Keyboard-based input driver for host simulator
// Maps keyboard keys to touch buttons
// TODO: Implement when SDL2 Bazel dependency is configured
class KeyboardInputDriver : public TouchButtonDriver {
 public:
  KeyboardInputDriver() = default;
  ~KeyboardInputDriver() override = default;

  pw::Status Init() override;
  pw::Result<lv_indev_t*> CreateLvglInputDevice() override;

 private:
  static void ReadCallback(lv_indev_t* indev, lv_indev_data_t* data);

  lv_indev_t* indev_ = nullptr;
};

}  // namespace maco::display
