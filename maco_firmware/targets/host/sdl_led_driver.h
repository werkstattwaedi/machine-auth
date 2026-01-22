// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <SDL2/SDL.h>

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>

#include "maco_firmware/modules/led/led_driver.h"
#include "pw_log/log.h"
#include "pw_status/status.h"

namespace maco::led {

/// SDL-based LED driver for host simulator.
/// Displays LEDs as colored circles in a separate window.
///
/// @tparam kNumLeds Number of LEDs to simulate (default 16).
template <uint16_t kNumLeds = 16>
class SdlLedDriver : public LedDriver<SdlLedDriver<kNumLeds>, kNumLeds> {
 public:
  using Base = LedDriver<SdlLedDriver<kNumLeds>, kNumLeds>;
  friend Base;

  /// Visual parameters for LED display.
  static constexpr int kLedDiameter = 20;
  static constexpr int kLedSpacing = 5;
  static constexpr int kPadding = 10;
  static constexpr int kWindowWidth =
      2 * kPadding + kNumLeds * kLedDiameter + (kNumLeds - 1) * kLedSpacing;
  static constexpr int kWindowHeight = 2 * kPadding + kLedDiameter;

  SdlLedDriver() = default;

  ~SdlLedDriver() {
    if (renderer_ != nullptr) {
      SDL_DestroyRenderer(renderer_);
    }
    if (window_ != nullptr) {
      SDL_DestroyWindow(window_);
    }
    // Note: Don't call SDL_Quit() here - let the display driver handle that
  }

 private:
  // CRTP implementation methods
  pw::Status DoInit() {
    // SDL should already be initialized by the display driver
    // Just create our LED window

    window_ = SDL_CreateWindow("MACO LEDs",
                               SDL_WINDOWPOS_UNDEFINED,
                               SDL_WINDOWPOS_UNDEFINED,
                               kWindowWidth,
                               kWindowHeight,
                               SDL_WINDOW_SHOWN);
    if (window_ == nullptr) {
      PW_LOG_ERROR("SDL_CreateWindow for LEDs failed: %s", SDL_GetError());
      return pw::Status::Internal();
    }

    renderer_ = SDL_CreateRenderer(window_, -1, SDL_RENDERER_SOFTWARE);
    if (renderer_ == nullptr) {
      PW_LOG_ERROR("SDL_CreateRenderer for LEDs failed: %s", SDL_GetError());
      SDL_DestroyWindow(window_);
      window_ = nullptr;
      return pw::Status::Internal();
    }

    // Initialize all pixels to black
    pixels_.fill(RgbwColor::Black());

    PW_LOG_INFO("SDL LED driver initialized: %u LEDs", kNumLeds);
    return pw::OkStatus();
  }

  void DoSetPixel(uint16_t index, RgbwColor color) { pixels_[index] = color; }
  RgbwColor DoGetPixel(uint16_t index) const { return pixels_[index]; }
  void DoSetBrightness(uint8_t b) { brightness_ = b; }
  uint8_t DoBrightness() const { return brightness_; }

  pw::Status DoShow() {
    if (renderer_ == nullptr) {
      return pw::Status::FailedPrecondition();
    }

    // Clear background to dark gray
    SDL_SetRenderDrawColor(renderer_, 32, 32, 32, 255);
    SDL_RenderClear(renderer_);

    // Draw each LED as a filled circle
    const int cy = kPadding + kLedDiameter / 2;
    const int radius = kLedDiameter / 2;

    for (uint16_t i = 0; i < kNumLeds; ++i) {
      const int cx = kPadding + radius + i * (kLedDiameter + kLedSpacing);

      uint8_t r, g, b;
      RgbwToRgb(pixels_[i], brightness_, r, g, b);
      DrawFilledCircle(cx, cy, radius, r, g, b);
    }

    SDL_RenderPresent(renderer_);
    return pw::OkStatus();
  }

  /// Convert RGBW color to RGB for SDL rendering.
  /// White channel is blended into RGB components.
  static void RgbwToRgb(const RgbwColor& rgbw,
                        uint8_t brightness,
                        uint8_t& r,
                        uint8_t& g,
                        uint8_t& b) {
    // Apply brightness scaling
    uint16_t scaled_r = (rgbw.r * brightness) / 255;
    uint16_t scaled_g = (rgbw.g * brightness) / 255;
    uint16_t scaled_b = (rgbw.b * brightness) / 255;
    uint16_t scaled_w = (rgbw.w * brightness) / 255;

    // Blend white into RGB (clamped to 255)
    r = static_cast<uint8_t>(std::min<uint16_t>(scaled_r + scaled_w, 255));
    g = static_cast<uint8_t>(std::min<uint16_t>(scaled_g + scaled_w, 255));
    b = static_cast<uint8_t>(std::min<uint16_t>(scaled_b + scaled_w, 255));
  }

  /// Draw a filled circle at the given position.
  void DrawFilledCircle(int cx,
                        int cy,
                        int radius,
                        uint8_t r,
                        uint8_t g,
                        uint8_t b) {
    SDL_SetRenderDrawColor(renderer_, r, g, b, 255);

    // Simple filled circle using horizontal lines
    for (int dy = -radius; dy <= radius; ++dy) {
      int dx = static_cast<int>(std::sqrt(radius * radius - dy * dy));
      SDL_RenderDrawLine(renderer_, cx - dx, cy + dy, cx + dx, cy + dy);
    }
  }

  std::array<RgbwColor, kNumLeds> pixels_{};
  uint8_t brightness_ = 255;
  SDL_Window* window_ = nullptr;
  SDL_Renderer* renderer_ = nullptr;
};

}  // namespace maco::led
