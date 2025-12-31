// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/targets/host/keyboard_input_driver.h"

#include "pw_log/log.h"

namespace maco::display {

pw::Status KeyboardInputDriver::Init() {
  // TODO: Initialize SDL keyboard input when SDL2 is available
  PW_LOG_WARN("Keyboard input driver not yet implemented");
  return pw::OkStatus();
}

pw::Result<lv_indev_t*> KeyboardInputDriver::CreateLvglInputDevice() {
  indev_ = lv_indev_create();
  if (indev_ == nullptr) {
    return pw::Status::Internal();
  }

  lv_indev_set_type(indev_, LV_INDEV_TYPE_BUTTON);
  lv_indev_set_user_data(indev_, this);
  lv_indev_set_read_cb(indev_, &KeyboardInputDriver::ReadCallback);

  return indev_;
}

void KeyboardInputDriver::ReadCallback(lv_indev_t* indev,
                                       lv_indev_data_t* data) {
  // TODO: Read keyboard state when SDL2 is available
  data->btn_id = 0;
  data->state = LV_INDEV_STATE_RELEASED;
  data->continue_reading = false;
}

}  // namespace maco::display
