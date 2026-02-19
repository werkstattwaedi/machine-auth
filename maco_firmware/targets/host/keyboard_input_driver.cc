// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/targets/host/keyboard_input_driver.h"

#include <SDL2/SDL.h>

#include "maco_firmware/targets/host/sdl_display_driver.h"
#include "pw_log/log.h"

namespace maco::display {

KeyboardInputDriver::KeyboardInputDriver(SdlDisplayDriver& display)
    : display_(display) {}

pw::Status KeyboardInputDriver::Init() {
  PW_LOG_INFO("Keyboard/mouse input driver initialized");
  return pw::OkStatus();
}

pw::Result<lv_indev_t*> KeyboardInputDriver::CreateLvglInputDevice() {
  indev_ = lv_indev_create();
  if (indev_ == nullptr) {
    return pw::Status::Internal();
  }

  lv_indev_set_type(indev_, LV_INDEV_TYPE_KEYPAD);
  lv_indev_set_user_data(indev_, this);
  lv_indev_set_read_cb(indev_, &KeyboardInputDriver::ReadCallback);

  return indev_;
}

void KeyboardInputDriver::ReadCallback(lv_indev_t* indev,
                                       lv_indev_data_t* data) {
  auto* self =
      static_cast<KeyboardInputDriver*>(lv_indev_get_user_data(indev));

  uint32_t key = 0;

  // Check keyboard state first
  const uint8_t* kb_state = SDL_GetKeyboardState(nullptr);
  if (kb_state[SDL_SCANCODE_UP]) {
    key = LV_KEY_PREV;
  } else if (kb_state[SDL_SCANCODE_DOWN]) {
    key = LV_KEY_NEXT;
  } else if (kb_state[SDL_SCANCODE_RETURN] ||
             kb_state[SDL_SCANCODE_KP_ENTER]) {
    key = LV_KEY_ENTER;
  } else if (kb_state[SDL_SCANCODE_ESCAPE]) {
    key = LV_KEY_ESC;
  }

  // Check mouse state if no keyboard key is pressed
  if (key == 0) {
    int wx, wy;
    uint32_t buttons = SDL_GetMouseState(&wx, &wy);
    if (buttons & SDL_BUTTON_LMASK) {
      // Convert window coordinates to logical image-space coordinates
      float lx, ly;
      SDL_RenderWindowToLogical(self->display_.renderer(), wx, wy, &lx, &ly);
      key = self->display_.HitTestButton(static_cast<int>(lx),
                                         static_cast<int>(ly));
    }
  }

  // First-pressed-wins + last_key_ pattern (matches CapTouchInputDriver)
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
