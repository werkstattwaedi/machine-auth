#pragma once

#include <XPT2046_Touch.h>
#include <lvgl.h>

#include "common.h"
#include "state/state.h"

class Display {
 public:
  static Display &instance();

  Status Begin();

  void RenderLoop();

 private:
  // Display is a singleton - use Display.instance()
  static Display *instance_;
  Display();

  virtual ~Display();
  Display(const Display &) = delete;
  Display &operator=(const Display &) = delete;

  lv_display_t *display_ = nullptr;
  lv_indev_t *touch_input = nullptr;

  SPIClass &spi_interface_;
  SPISettings spi_settings_;
  XPT2046_Touchscreen touchscreen_interface_;

  void SendCommand(const uint8_t *cmd, size_t cmd_size,
                         const uint8_t *param, size_t param_size);
  void SendColor(const uint8_t *cmd, size_t cmd_size, const uint8_t *param,
                      size_t param_size);

  void ReadTouchInput(lv_indev_t *indev, lv_indev_data_t *data);
};
