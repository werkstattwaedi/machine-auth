// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/devices/cap_touch/cap_touch_input_driver.h"

#include "pw_log/log.h"

namespace maco::display {

pw::Status CapTouchInputDriver::Init() {
  // TODO: Initialize capacitive touch hardware
  // - Configure I2C or GPIO for touch controller
  // - Set up interrupt if available
  PW_LOG_WARN("Capacitive touch driver not yet implemented");
  return pw::OkStatus();
}

pw::Result<lv_indev_t*> CapTouchInputDriver::CreateLvglInputDevice() {
  indev_ = lv_indev_create();
  if (indev_ == nullptr) {
    return pw::Status::Internal();
  }

  lv_indev_set_type(indev_, LV_INDEV_TYPE_BUTTON);
  lv_indev_set_user_data(indev_, this);
  lv_indev_set_read_cb(indev_, &CapTouchInputDriver::ReadCallback);

  return indev_;
}

void CapTouchInputDriver::ReadCallback(lv_indev_t* indev,
                                        lv_indev_data_t* data) {
  // TODO: Read capacitive touch state from hardware
  data->btn_id = 0;
  data->state = LV_INDEV_STATE_RELEASED;
  data->continue_reading = false;
}

}  // namespace maco::display
