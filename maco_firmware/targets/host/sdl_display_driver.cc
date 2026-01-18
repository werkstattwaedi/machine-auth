// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/targets/host/sdl_display_driver.h"

#include <SDL2/SDL.h>
#include <cstdio>
#include <cstdlib>

#include "pw_assert/check.h"
#include "pw_log/log.h"

namespace maco::display {

pw::Status SdlDisplayDriver::Init() {
  if (SDL_Init(SDL_INIT_VIDEO) < 0) {
    PW_LOG_ERROR("SDL_Init failed: %s", SDL_GetError());
    return pw::Status::Internal();
  }

  window_ = SDL_CreateWindow("MACO Simulator",
                             SDL_WINDOWPOS_CENTERED,
                             SDL_WINDOWPOS_CENTERED,
                             kWidth * kScale,
                             kHeight * kScale,
                             SDL_WINDOW_SHOWN);
  if (window_ == nullptr) {
    PW_LOG_ERROR("SDL_CreateWindow failed: %s", SDL_GetError());
    return pw::Status::Internal();
  }

  // Use software renderer to allow texture updates from render thread
  // (SDL's OpenGL context is not thread-safe across threads)
  renderer_ = SDL_CreateRenderer(window_, -1, SDL_RENDERER_SOFTWARE);
  if (renderer_ == nullptr) {
    PW_LOG_ERROR("SDL_CreateRenderer failed: %s", SDL_GetError());
    SDL_DestroyWindow(window_);
    window_ = nullptr;
    return pw::Status::Internal();
  }

  // Create texture for LVGL framebuffer (RGB565)
  texture_ = SDL_CreateTexture(renderer_,
                               SDL_PIXELFORMAT_RGB565,
                               SDL_TEXTUREACCESS_STREAMING,
                               kWidth,
                               kHeight);
  if (texture_ == nullptr) {
    PW_LOG_ERROR("SDL_CreateTexture failed: %s", SDL_GetError());
    SDL_DestroyRenderer(renderer_);
    SDL_DestroyWindow(window_);
    renderer_ = nullptr;
    window_ = nullptr;
    return pw::Status::Internal();
  }

  PW_LOG_INFO("SDL display initialized: %dx%d (scale %d)", kWidth, kHeight,
              kScale);
  return pw::OkStatus();
}

SdlDisplayDriver::~SdlDisplayDriver() {
  // Destroy LVGL display first (stops using buffers)
  if (display_ != nullptr) {
    lv_display_delete(display_);
  }
  free(draw_buf1_);
  free(draw_buf2_);
  if (texture_ != nullptr) {
    SDL_DestroyTexture(texture_);
  }
  if (renderer_ != nullptr) {
    SDL_DestroyRenderer(renderer_);
  }
  if (window_ != nullptr) {
    SDL_DestroyWindow(window_);
  }
  SDL_Quit();
}

pw::Result<lv_display_t*> SdlDisplayDriver::CreateLvglDisplay() {
  if (window_ == nullptr || renderer_ == nullptr || texture_ == nullptr) {
    PW_LOG_ERROR("CreateLvglDisplay called before Init()");
    return pw::Status::FailedPrecondition();
  }

  display_ = lv_display_create(kWidth, kHeight);
  if (display_ == nullptr) {
    PW_LOG_ERROR("lv_display_create returned null");
    return pw::Status::Internal();
  }

  // Set color format to RGB565 to match SDL texture format
  lv_display_set_color_format(display_, LV_COLOR_FORMAT_RGB565);

  // Allocate draw buffers (RGB565 = 2 bytes per pixel)
  const size_t buf_size_pixels = kWidth * kBufferLines;
  const size_t buf_size_bytes = buf_size_pixels * 2;

  // Use aligned_alloc for proper alignment (LVGL requires 4-byte alignment)
  draw_buf1_ = aligned_alloc(4, buf_size_bytes);
  draw_buf2_ = aligned_alloc(4, buf_size_bytes);

  if (draw_buf1_ == nullptr || draw_buf2_ == nullptr) {
    PW_LOG_ERROR("Failed to allocate LVGL buffers");
    free(draw_buf1_);
    free(draw_buf2_);
    draw_buf1_ = nullptr;
    draw_buf2_ = nullptr;
    lv_display_delete(display_);
    display_ = nullptr;
    return pw::Status::ResourceExhausted();
  }

  lv_display_set_buffers(display_, draw_buf1_, draw_buf2_, buf_size_bytes,
                         LV_DISPLAY_RENDER_MODE_PARTIAL);
  lv_display_set_flush_cb(display_, &SdlDisplayDriver::FlushCallback);
  lv_display_set_user_data(display_, this);

  PW_LOG_INFO("LVGL display created with %zu byte buffers (RGB565)", buf_size_bytes);
  return display_;
}

void SdlDisplayDriver::FlushCallback(lv_display_t* disp,
                                     const lv_area_t* area,
                                     uint8_t* px_map) {
  auto* self = static_cast<SdlDisplayDriver*>(lv_display_get_user_data(disp));
  PW_CHECK_NOTNULL(self);
  self->Flush(area, px_map);
  lv_display_flush_ready(disp);
}

void SdlDisplayDriver::Flush(const lv_area_t* area, uint8_t* px_map) {
  if (texture_ == nullptr) {
    return;
  }

  // Calculate area dimensions
  lv_coord_t w = lv_area_get_width(area);
  lv_coord_t h = lv_area_get_height(area);

  // Update the texture region with the new pixels
  SDL_Rect rect = {
      .x = area->x1,
      .y = area->y1,
      .w = w,
      .h = h,
  };

  // Lock mutex to synchronize with Present() on main thread
  std::lock_guard<std::mutex> lock(texture_mutex_);

  // px_map is RGB565, pitch is width * 2 bytes per pixel
  SDL_UpdateTexture(texture_, &rect, px_map, w * 2);
}

void SdlDisplayDriver::Present() {
  if (renderer_ == nullptr || texture_ == nullptr) {
    return;
  }

  // Lock mutex to synchronize with Flush() on render thread
  std::lock_guard<std::mutex> lock(texture_mutex_);

  SDL_RenderClear(renderer_);
  SDL_RenderCopy(renderer_, texture_, nullptr, nullptr);
  SDL_RenderPresent(renderer_);
}

void SdlDisplayDriver::PumpEvents() {
  SDL_Event event;
  while (SDL_PollEvent(&event)) {
    if (event.type == SDL_QUIT) {
      quit_requested_ = true;
    }
  }
}

}  // namespace maco::display
