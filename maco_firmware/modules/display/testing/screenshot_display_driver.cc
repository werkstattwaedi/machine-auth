// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/modules/display/testing/screenshot_display_driver.h"

#include <algorithm>
#include <cstring>

#include "pw_assert/check.h"

namespace maco::display::testing {

ScreenshotDisplayDriver::~ScreenshotDisplayDriver() {
  if (display_ != nullptr) {
    lv_display_delete(display_);
  }
}

pw::Status ScreenshotDisplayDriver::Init() {
  // Allocate buffers on the heap
  framebuffer_ = std::make_unique<uint16_t[]>(kFramebufferSize);
  draw_buf1_ = std::make_unique<uint16_t[]>(kDrawBufferSize);
  draw_buf2_ = std::make_unique<uint16_t[]>(kDrawBufferSize);

  ClearFramebuffer();
  return pw::OkStatus();
}

pw::Result<lv_display_t*> ScreenshotDisplayDriver::CreateLvglDisplay() {
  if (!framebuffer_) {
    return pw::Status::FailedPrecondition();
  }

  display_ = lv_display_create(kWidth, kHeight);
  if (display_ == nullptr) {
    return pw::Status::Internal();
  }

  lv_display_set_color_format(display_, LV_COLOR_FORMAT_RGB565);

  const size_t buf_size_bytes = kDrawBufferSize * sizeof(uint16_t);
  lv_display_set_buffers(display_, draw_buf1_.get(), draw_buf2_.get(),
                         buf_size_bytes, LV_DISPLAY_RENDER_MODE_PARTIAL);

  lv_display_set_flush_cb(display_, &ScreenshotDisplayDriver::FlushCallback);
  lv_display_set_user_data(display_, this);

  return display_;
}

void ScreenshotDisplayDriver::FlushCallback(lv_display_t* disp,
                                            const lv_area_t* area,
                                            uint8_t* px_map) {
  auto* self =
      static_cast<ScreenshotDisplayDriver*>(lv_display_get_user_data(disp));
  PW_CHECK_NOTNULL(self);

  // Cast px_map to uint16_t since we're using RGB565
  self->Flush(area, reinterpret_cast<const uint16_t*>(px_map));
  lv_display_flush_ready(disp);
}

void ScreenshotDisplayDriver::Flush(const lv_area_t* area,
                                    const uint16_t* px_map) {
  // Copy the partial update to the full framebuffer
  const int32_t w = lv_area_get_width(area);
  const int32_t h = lv_area_get_height(area);

  for (int32_t y = 0; y < h; ++y) {
    const int32_t fb_y = area->y1 + y;
    const size_t fb_offset = static_cast<size_t>(fb_y) * kWidth +
                             static_cast<size_t>(area->x1);
    const size_t src_offset = static_cast<size_t>(y) * static_cast<size_t>(w);

    std::memcpy(&framebuffer_[fb_offset], &px_map[src_offset],
                static_cast<size_t>(w) * sizeof(uint16_t));
  }
}

pw::span<const uint16_t> ScreenshotDisplayDriver::framebuffer() const {
  if (!framebuffer_) {
    return {};
  }
  return {framebuffer_.get(), kFramebufferSize};
}

void ScreenshotDisplayDriver::ClearFramebuffer() {
  if (framebuffer_) {
    std::fill(framebuffer_.get(), framebuffer_.get() + kFramebufferSize, 0);
  }
}

}  // namespace maco::display::testing
