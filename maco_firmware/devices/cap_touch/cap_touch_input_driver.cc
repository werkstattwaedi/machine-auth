// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#define PW_LOG_MODULE_NAME "TOUCH"

#include "maco_firmware/devices/cap_touch/cap_touch_input_driver.h"

#include "pw_log/log.h"

namespace maco::display {

// Button-to-channel mapping (CAP1296 channels → LVGL keys):
//   Channel 0 (lower right) → LV_KEY_ENTER (OK)
//   Channel 1 (top right)   → LV_KEY_NEXT  (Down)
//   Channel 3 (top left)    → LV_KEY_PREV  (Up)
//   Channel 4 (lower left)  → LV_KEY_ESC   (Cancel)

CapTouchInputDriver::CapTouchInputDriver(pw::i2c::Initiator& i2c)
    : cap1296_(i2c) {}

pw::Status CapTouchInputDriver::Init() { return cap1296_.Init(); }

pw::Result<lv_indev_t*> CapTouchInputDriver::CreateLvglInputDevice() {
  indev_ = lv_indev_create();
  if (indev_ == nullptr) {
    return pw::Status::Internal();
  }

  lv_indev_set_type(indev_, LV_INDEV_TYPE_KEYPAD);
  lv_indev_set_user_data(indev_, this);
  lv_indev_set_read_cb(indev_, &CapTouchInputDriver::ReadCallback);

  return indev_;
}

void CapTouchInputDriver::ReadCallback(lv_indev_t* indev,
                                       lv_indev_data_t* data) {
  auto* self =
      static_cast<CapTouchInputDriver*>(lv_indev_get_user_data(indev));

  const uint8_t touched = self->cap1296_.Touched();

  // First-pressed-wins priority mapping
  uint32_t key = 0;
  if (touched & (1 << 0)) {
    key = LV_KEY_ENTER;
  } else if (touched & (1 << 4)) {
    key = LV_KEY_ESC;
  } else if (touched & (1 << 3)) {
    key = LV_KEY_PREV;
  } else if (touched & (1 << 1)) {
    key = LV_KEY_NEXT;
  }

  if (key != 0) {
    self->last_key_ = key;
    data->key = key;
    data->state = LV_INDEV_STATE_PRESSED;
  } else {
    data->key = self->last_key_;
    data->state = LV_INDEV_STATE_RELEASED;
  }

  data->continue_reading = false;
}

}  // namespace maco::display
