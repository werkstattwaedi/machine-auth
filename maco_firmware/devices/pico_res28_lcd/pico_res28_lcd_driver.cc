// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/devices/pico_res28_lcd/pico_res28_lcd_driver.h"

#include "pw_log/log.h"

namespace maco::display {

pw::Status PicoRes28LcdDriver::Init(uint16_t width, uint16_t height) {
  width_ = width;
  height_ = height;

  // TODO: Initialize SPI bus and ST7789 controller
  // - Configure SPI pins (MOSI, SCK, CS, DC, RST, BL)
  // - Send initialization commands to ST7789
  // - Enable backlight
  PW_LOG_WARN("PicoRes28LcdDriver not yet implemented - display will be blank");

  return pw::OkStatus();
}

pw::Result<lv_display_t*> PicoRes28LcdDriver::CreateLvglDisplay() {
  display_ = lv_display_create(width_, height_);
  if (display_ == nullptr) {
    return pw::Status::Internal();
  }

  // Store this pointer for callback
  lv_display_set_user_data(display_, this);
  lv_display_set_flush_cb(display_, &PicoRes28LcdDriver::FlushCallback);

  // Set up draw buffers (1/10 screen, double buffered)
  size_t buf_size = width_ * kBufferLines *
                    lv_color_format_get_size(lv_display_get_color_format(display_));
  lv_display_set_buffers(display_, draw_buf1_, draw_buf2_, buf_size,
                         LV_DISPLAY_RENDER_MODE_PARTIAL);

  return display_;
}

void PicoRes28LcdDriver::FlushCallback(lv_display_t* disp,
                                        const lv_area_t* area,
                                        uint8_t* px_map) {
  auto* self = static_cast<PicoRes28LcdDriver*>(lv_display_get_user_data(disp));
  self->Flush(area, px_map);
  lv_display_flush_ready(disp);
}

void PicoRes28LcdDriver::Flush(const lv_area_t* area, uint8_t* px_map) {
  // TODO: Send pixels to ST7789 via SPI
  // - Set column address (CASET)
  // - Set row address (RASET)
  // - Write memory (RAMWR)
  (void)area;
  (void)px_map;
}

}  // namespace maco::display
