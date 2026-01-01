// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/targets/host/sdl_display_driver.h"

#include "pw_log/log.h"

namespace maco::display {

pw::Status SdlDisplayDriver::Init() {
  // TODO: Initialize SDL window when SDL2 is available
  PW_LOG_WARN("SDL display driver not yet implemented - display will be blank");

  return pw::OkStatus();
}

pw::Result<lv_display_t*> SdlDisplayDriver::CreateLvglDisplay() {
  display_ = lv_display_create(kWidth, kHeight);
  if (display_ == nullptr) {
    return pw::Status::Internal();
  }

  // Store this pointer for callback
  lv_display_set_user_data(display_, this);
  lv_display_set_flush_cb(display_, &SdlDisplayDriver::FlushCallback);

  // Set up draw buffers (1/10 screen, double buffered)
  size_t buf_size = kWidth * kBufferLines *
                    lv_color_format_get_size(lv_display_get_color_format(display_));
  lv_display_set_buffers(display_, draw_buf1_, draw_buf2_, buf_size,
                         LV_DISPLAY_RENDER_MODE_PARTIAL);

  return display_;
}

void SdlDisplayDriver::FlushCallback(lv_display_t* disp,
                                     const lv_area_t* area,
                                     uint8_t* px_map) {
  auto* self = static_cast<SdlDisplayDriver*>(lv_display_get_user_data(disp));
  self->Flush(area, px_map);
  lv_display_flush_ready(disp);
}

void SdlDisplayDriver::Flush(const lv_area_t* area, uint8_t* px_map) {
  // TODO: Blit pixels to SDL surface/texture when SDL2 is available
  (void)area;
  (void)px_map;
}

}  // namespace maco::display
