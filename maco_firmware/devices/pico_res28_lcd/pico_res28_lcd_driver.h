// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include "maco_firmware/modules/display/display_driver.h"

namespace maco::display {

// SPI LCD driver for Pico-ResTouch-LCD-2.8 display
// Uses ST7789 controller connected via SPI
class PicoRes28LcdDriver : public DisplayDriver {
 public:
  PicoRes28LcdDriver() = default;
  ~PicoRes28LcdDriver() override = default;

  pw::Status Init(uint16_t width, uint16_t height) override;
  pw::Result<lv_display_t*> CreateLvglDisplay() override;

  uint16_t width() const override { return width_; }
  uint16_t height() const override { return height_; }

 private:
  static void FlushCallback(lv_display_t* disp,
                            const lv_area_t* area,
                            uint8_t* px_map);
  void Flush(const lv_area_t* area, uint8_t* px_map);

  lv_display_t* display_ = nullptr;
  uint16_t width_ = 0;
  uint16_t height_ = 0;

  // Draw buffers (1/10 of screen, double buffered)
  static constexpr size_t kBufferLines = 32;  // ~1/10 of 320
  uint8_t draw_buf1_[240 * kBufferLines * 2];  // RGB565
  uint8_t draw_buf2_[240 * kBufferLines * 2];
};

}  // namespace maco::display
