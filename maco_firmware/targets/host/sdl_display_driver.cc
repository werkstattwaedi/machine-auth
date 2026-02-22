// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/targets/host/sdl_display_driver.h"

#include <SDL2/SDL.h>
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <limits>
#include <string>
#include <utility>
#include <vector>

#include "lodepng.h"
#include "maco_firmware/modules/display/display_metrics.h"
#include "pw_assert/check.h"
#include "pw_log/log.h"

namespace maco::display {

// ---------------------------------------------------------------------------
// LED overlay constants
// ---------------------------------------------------------------------------
namespace {

// Hardware LED indices for each zone (must match led_animator.h constants).
//
// Ring: 10 LEDs clockwise from bottom-left (ring position → hw LED index)
constexpr uint16_t kRingLedHwIdx[10] = {5, 6, 7, 8, 9, 12, 13, 14, 15, 0};
// Buttons: top-left, top-right, bottom-left, bottom-right
constexpr uint16_t kButtonLedHwIdx[4] = {10, 11, 4, 1};
// NFC: LEDs 2 and 3 are driven identically; use index 3
constexpr uint16_t kNfcLedHwIdx = 3;

// Pixel positions of the 10 ambient ring LEDs in image coordinates.
// Clockwise from bottom-left, as measured on MacoTerminal.png.
constexpr std::pair<int, int> kRingPixelPos[10] = {
    {73, 825},   // 0: bottom-left
    {73, 550},   // 1: left-middle-lower
    {73, 270},   // 2: left-middle-upper
    {91, 114},   // 3: top-left
    {216, 97},   // 4: top-middle-left
    {400, 97},   // 5: top-middle-right
    {525, 114},  // 6: top-right
    {540, 270},  // 7: right-middle-upper
    {540, 550},  // 8: right-middle-lower
    {540, 825},  // 9: bottom-right
};

// Button LED indicator centers (center of each button region).
constexpr std::pair<int, int> kButtonCenter[4] = {
    {280, 159},  // top-left
    {330, 159},  // top-right
    {205, 740},  // bottom-left
    {409, 740},  // bottom-right
};

// NFC area (x, y, w, h) and glow center, measured on MacoTerminal.png.
constexpr SDL_Rect kNfcRect = {175, 823, 248, 212};
constexpr std::pair<int, int> kNfcCenter = {290, 760};

// Device body outline in image coordinates. Used to clip ambient ring glow so
// it only appears on the outside of the device.
constexpr int kDevTop = 98;
constexpr int kDevBottom = 1086;
constexpr int kDevLeft = 70;
constexpr int kDevRight = 540;
constexpr int kDevCornerR = 40;

// ---------------------------------------------------------------------------
// SDL drawing helpers
// ---------------------------------------------------------------------------

void RgbwToRgb(const maco::led::RgbwColor& rgbw, uint8_t brightness,
               uint8_t& r, uint8_t& g, uint8_t& b) {
  uint16_t sr = (static_cast<uint16_t>(rgbw.r) * brightness) / 255;
  uint16_t sg = (static_cast<uint16_t>(rgbw.g) * brightness) / 255;
  uint16_t sb = (static_cast<uint16_t>(rgbw.b) * brightness) / 255;
  uint16_t sw = (static_cast<uint16_t>(rgbw.w) * brightness) / 255;
  r = static_cast<uint8_t>(std::min<uint16_t>(sr + sw, 255));
  g = static_cast<uint8_t>(std::min<uint16_t>(sg + sw, 255));
  b = static_cast<uint8_t>(std::min<uint16_t>(sb + sw, 255));
}

// Returns the x span [xl, xr] of the device interior at row y.
// If y is outside the device height range, returns {INT_MAX, INT_MIN}
// (empty interval — no clipping needed on that row).
std::pair<int, int> DeviceInteriorSpan(int y) {
  if (y < kDevTop || y > kDevBottom) {
    return {std::numeric_limits<int>::max(), std::numeric_limits<int>::min()};
  }
  int xl = kDevLeft;
  int xr = kDevRight;
  if (y < kDevTop + kDevCornerR) {
    float dy = static_cast<float>(kDevTop + kDevCornerR - y);
    int dx = static_cast<int>(
        std::sqrt(static_cast<float>(kDevCornerR * kDevCornerR) - dy * dy));
    xl = kDevLeft + kDevCornerR - dx;
    xr = kDevRight - kDevCornerR + dx;
  } else if (y > kDevBottom - kDevCornerR) {
    float dy = static_cast<float>(y - (kDevBottom - kDevCornerR));
    int dx = static_cast<int>(
        std::sqrt(static_cast<float>(kDevCornerR * kDevCornerR) - dy * dy));
    xl = kDevLeft + kDevCornerR - dx;
    xr = kDevRight - kDevCornerR + dx;
  }
  return {xl, xr};
}

// Draw a filled circle, clipping out the device interior on each scanline.
// Pixels inside the device body are skipped so the glow only appears outside.
void DrawFilledCircleClipped(SDL_Renderer* renderer, int cx, int cy,
                              int radius) {
  for (int dy = -radius; dy <= radius; ++dy) {
    int y = cy + dy;
    int dx = static_cast<int>(
        std::sqrt(static_cast<float>(radius * radius - dy * dy)));
    int x_min = cx - dx;
    int x_max = cx + dx;

    auto [ixl, ixr] = DeviceInteriorSpan(y);

    if (ixl > ixr) {
      // Row outside device — draw whole span
      SDL_RenderDrawLine(renderer, x_min, y, x_max, y);
    } else {
      // Draw only the portions outside [ixl, ixr]
      if (x_min < ixl) {
        SDL_RenderDrawLine(renderer, x_min, y,
                           std::min(ixl - 1, x_max), y);
      }
      if (x_max > ixr) {
        SDL_RenderDrawLine(renderer, std::max(ixr + 1, x_min), y,
                           x_max, y);
      }
    }
  }
}

void DrawFilledCircle(SDL_Renderer* renderer, int cx, int cy, int radius) {
  for (int dy = -radius; dy <= radius; ++dy) {
    int dx = static_cast<int>(
        std::sqrt(static_cast<float>(radius * radius - dy * dy)));
    SDL_RenderDrawLine(renderer, cx - dx, cy + dy, cx + dx, cy + dy);
  }
}

// Glow layer table: radius fraction (out of 8) and additive alpha.
struct GlowLayer {
  int radius_frac;  // Effective radius = outer_radius * radius_frac / 8
  uint8_t alpha;
};
static constexpr GlowLayer kGlowLayers[] = {
    {8, 15}, {7, 30}, {6, 50}, {5, 80}, {4, 120}, {3, 170}, {2, 220},
};

// Draw a soft radial glow at (cx, cy) using additive blending.
// Pixels inside the device body are excluded — glow only appears outside.
void DrawGlowClipped(SDL_Renderer* renderer, int cx, int cy, uint8_t r,
                     uint8_t g, uint8_t b, int outer_radius) {
  if (r == 0 && g == 0 && b == 0) return;
  SDL_SetRenderDrawBlendMode(renderer, SDL_BLENDMODE_ADD);
  for (const auto& layer : kGlowLayers) {
    int radius = outer_radius * layer.radius_frac / 8;
    SDL_SetRenderDrawColor(renderer, r, g, b, layer.alpha);
    DrawFilledCircleClipped(renderer, cx, cy, radius);
  }
  SDL_SetRenderDrawBlendMode(renderer, SDL_BLENDMODE_NONE);
}

// Draw an unclipped glow (for buttons and NFC, which are inside the device).
void DrawGlow(SDL_Renderer* renderer, int cx, int cy, uint8_t r, uint8_t g,
              uint8_t b, int outer_radius) {
  if (r == 0 && g == 0 && b == 0) return;
  SDL_SetRenderDrawBlendMode(renderer, SDL_BLENDMODE_ADD);
  for (const auto& layer : kGlowLayers) {
    int radius = outer_radius * layer.radius_frac / 8;
    SDL_SetRenderDrawColor(renderer, r, g, b, layer.alpha);
    DrawFilledCircle(renderer, cx, cy, radius);
  }
  SDL_SetRenderDrawBlendMode(renderer, SDL_BLENDMODE_NONE);
}

// // Draw a semi-transparent colored rectangle overlay (standard alpha blend).
// void DrawRectOverlay(SDL_Renderer* renderer, const SDL_Rect& rect, uint8_t r,
//                      uint8_t g, uint8_t b, uint8_t alpha) {
//   if (r == 0 && g == 0 && b == 0) return;
//   SDL_SetRenderDrawBlendMode(renderer, SDL_BLENDMODE_BLEND);
//   SDL_SetRenderDrawColor(renderer, r, g, b, alpha);
//   SDL_RenderFillRect(renderer, &rect);
//   SDL_SetRenderDrawBlendMode(renderer, SDL_BLENDMODE_NONE);
// }

}  // namespace

// ---------------------------------------------------------------------------
// SdlDisplayDriver implementation
// ---------------------------------------------------------------------------

bool SdlDisplayDriver::LoadBackgroundImage() {
  // Resolve the PNG path via BUILD_WORKSPACE_DIRECTORY (set by `bazel run`)
  const char* workspace_dir = std::getenv("BUILD_WORKSPACE_DIRECTORY");
  if (workspace_dir == nullptr) {
    PW_LOG_WARN("BUILD_WORKSPACE_DIRECTORY not set, no background image");
    return false;
  }

  std::string png_path = std::string(workspace_dir) +
                          "/maco_firmware/targets/host/MacoTerminal.png";

  std::vector<uint8_t> png_data;
  unsigned error = lodepng::load_file(png_data, png_path);
  if (error) {
    PW_LOG_WARN("Failed to load %s: %s", png_path.c_str(),
                lodepng_error_text(error));
    return false;
  }

  std::vector<uint8_t> rgba;
  unsigned img_w, img_h;
  error = lodepng::decode(rgba, img_w, img_h, png_data);
  if (error) {
    PW_LOG_WARN("Failed to decode PNG: %s", lodepng_error_text(error));
    return false;
  }

  bg_texture_ = SDL_CreateTexture(renderer_, SDL_PIXELFORMAT_ABGR8888,
                                  SDL_TEXTUREACCESS_STATIC, img_w, img_h);
  if (bg_texture_ == nullptr) {
    PW_LOG_WARN("Failed to create background texture: %s", SDL_GetError());
    return false;
  }

  SDL_UpdateTexture(bg_texture_, nullptr, rgba.data(), img_w * 4);
  PW_LOG_INFO("Background image loaded: %ux%u", img_w, img_h);
  return true;
}

pw::Status SdlDisplayDriver::Init() {
  if (SDL_Init(SDL_INIT_VIDEO) < 0) {
    PW_LOG_ERROR("SDL_Init failed: %s", SDL_GetError());
    return pw::Status::Internal();
  }

  window_ = SDL_CreateWindow("MACO Simulator",
                             SDL_WINDOWPOS_CENTERED,
                             SDL_WINDOWPOS_CENTERED,
                             kWindowWidth,
                             kWindowHeight,
                             SDL_WINDOW_SHOWN | SDL_WINDOW_RESIZABLE);
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

  // Logical size keeps all coordinates in image-space regardless of window size
  SDL_RenderSetLogicalSize(renderer_, kWindowWidth, kWindowHeight);

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

  // Try to load background image (non-fatal if missing)
  LoadBackgroundImage();

  PW_LOG_INFO("SDL display initialized: %dx%d (window %dx%d)", kWidth, kHeight,
              kWindowWidth, kWindowHeight);
  return pw::OkStatus();
}

SdlDisplayDriver::~SdlDisplayDriver() {
  // Destroy LVGL display first (stops using buffers)
  if (display_ != nullptr) {
    lv_display_delete(display_);
  }
  free(draw_buf1_);
  free(draw_buf2_);
  if (bg_texture_ != nullptr) {
    SDL_DestroyTexture(bg_texture_);
  }
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

  metrics::OnFlushRegion(w, h);

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

void SdlDisplayDriver::UpdateLedPixels(const led::RgbwColor* pixels, int count,
                                       uint8_t brightness) {
  std::lock_guard<std::mutex> lock(led_mutex_);
  int copy_count = std::min(count, kNumLeds);
  for (int i = 0; i < copy_count; ++i) {
    led_pixels_[i] = pixels[i];
  }
  led_brightness_ = brightness;
}

void SdlDisplayDriver::RenderLedOverlays(
    const std::array<led::RgbwColor, kNumLeds>& pixels, uint8_t brightness) {
  // Ambient ring: glow clipped to the outside of the device body only.
  for (int i = 0; i < 10; ++i) {
    uint8_t r, g, b;
    RgbwToRgb(pixels[kRingLedHwIdx[i]], brightness, r, g, b);
    DrawGlowClipped(renderer_, kRingPixelPos[i].first, kRingPixelPos[i].second,
                    r, g, b, /*outer_radius=*/80);
  }

  // Buttons: tint rect + glow clipped to each button's own region.
  for (int i = 0; i < 4; ++i) {
    uint8_t r, g, b;
    RgbwToRgb(pixels[kButtonLedHwIdx[i]], brightness, r, g, b);
    SDL_Rect rect = {kButtons[i].x1, kButtons[i].y1,
                     kButtons[i].x2 - kButtons[i].x1,
                     kButtons[i].y2 - kButtons[i].y1};
    // DrawRectOverlay(renderer_, rect, r, g, b, /*alpha=*/80);
    SDL_RenderSetClipRect(renderer_, &rect);
    DrawGlow(renderer_, kButtonCenter[i].first, kButtonCenter[i].second, r, g,
             b, /*outer_radius=*/160);
    SDL_RenderSetClipRect(renderer_, nullptr);
  }

  // NFC area: tint rect + glow clipped to the NFC rect.
  {
    uint8_t r, g, b;
    RgbwToRgb(pixels[kNfcLedHwIdx], brightness, r, g, b);
    // DrawRectOverlay(renderer_, kNfcRect, r, g, b, /*alpha=*/80);
    SDL_RenderSetClipRect(renderer_, &kNfcRect);
    DrawGlow(renderer_, kNfcCenter.first, kNfcCenter.second, r, g, b,
             /*outer_radius=*/300);
    SDL_RenderSetClipRect(renderer_, nullptr);
  }
}

void SdlDisplayDriver::Present() {
  if (renderer_ == nullptr || texture_ == nullptr) {
    return;
  }

  // Snapshot LED state before acquiring texture mutex to avoid lock ordering
  // issues (LED thread holds led_mutex_ but never texture_mutex_).
  std::array<led::RgbwColor, kNumLeds> led_snap;
  uint8_t brightness_snap;
  {
    std::lock_guard<std::mutex> led_lock(led_mutex_);
    led_snap = led_pixels_;
    brightness_snap = led_brightness_;
  }

  std::lock_guard<std::mutex> lock(texture_mutex_);

  SDL_RenderClear(renderer_);

  // Render background image (full window) if available
  if (bg_texture_ != nullptr) {
    SDL_RenderCopy(renderer_, bg_texture_, nullptr, nullptr);
  }

  // Overlay the LVGL display at the correct position within the background
  SDL_Rect dst = {
      .x = kDisplayOffsetX,
      .y = kDisplayOffsetY,
      .w = kWidth,
      .h = kHeight,
  };
  SDL_RenderCopy(renderer_, texture_, nullptr, &dst);

  // Render LED overlays on top of device image
  RenderLedOverlays(led_snap, brightness_snap);

  SDL_RenderPresent(renderer_);
}

void SdlDisplayDriver::PumpEvents() {
  SDL_Event event;
  while (SDL_PollEvent(&event)) {
    if (event.type == SDL_QUIT) {
      quit_requested_ = true;
    }
    // Enforce aspect ratio on resize
    if (event.type == SDL_WINDOWEVENT &&
        event.window.event == SDL_WINDOWEVENT_RESIZED) {
      int new_w = event.window.data1;
      int new_h = event.window.data2;

      // Calculate the correct size maintaining aspect ratio
      int fit_w = new_h * kWindowWidth / kWindowHeight;
      int fit_h = new_w * kWindowHeight / kWindowWidth;

      if (fit_w <= new_w) {
        new_w = fit_w;
      } else {
        new_h = fit_h;
      }
      SDL_SetWindowSize(window_, new_w, new_h);
    }
  }
}

uint32_t SdlDisplayDriver::HitTestButton(int x, int y) const {
  for (const auto& btn : kButtons) {
    if (x >= btn.x1 && x <= btn.x2 && y >= btn.y1 && y <= btn.y2) {
      return btn.lv_key;
    }
  }
  return 0;
}

}  // namespace maco::display
