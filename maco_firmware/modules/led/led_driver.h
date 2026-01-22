// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <cstdint>

#include "pw_assert/check.h"
#include "pw_status/status.h"

namespace maco::led {

/// RGBW color representation for individually-addressable LEDs.
struct RgbwColor {
  uint8_t r = 0;
  uint8_t g = 0;
  uint8_t b = 0;
  uint8_t w = 0;

  static constexpr RgbwColor Black() { return {}; }
  static constexpr RgbwColor White() { return {0, 0, 0, 255}; }
  static constexpr RgbwColor Red() { return {255, 0, 0, 0}; }
  static constexpr RgbwColor Green() { return {0, 255, 0, 0}; }
  static constexpr RgbwColor Blue() { return {0, 0, 255, 0}; }
  static constexpr RgbwColor Yellow() { return {255, 255, 0, 0}; }
  static constexpr RgbwColor Cyan() { return {0, 255, 255, 0}; }
  static constexpr RgbwColor Magenta() { return {255, 0, 255, 0}; }
};

/// CRTP base for LED drivers. Provides high-bandwidth inline access.
///
/// Derived classes must implement:
/// - pw::Status DoInit()
/// - void DoSetPixel(uint16_t index, RgbwColor color)
/// - RgbwColor DoGetPixel(uint16_t index) const
/// - void DoSetBrightness(uint8_t brightness)
/// - uint8_t DoBrightness() const
/// - pw::Status DoShow()
template <typename Derived, uint16_t kNumLeds>
class LedDriver {
  static_assert(kNumLeds > 0, "Must have at least one LED");
  static_assert(kNumLeds <= 1024, "Too many LEDs for SPI buffer");

 public:
  static constexpr uint16_t kLedCount = kNumLeds;

  /// Initialize the driver hardware.
  pw::Status Init() { return static_cast<Derived*>(this)->DoInit(); }

  /// Set a single pixel color. Index is bounds-checked.
  void SetPixel(uint16_t index, RgbwColor color) {
    PW_CHECK_UINT_LT(index, kNumLeds, "Pixel index out of bounds");
    static_cast<Derived*>(this)->DoSetPixel(index, color);
  }

  /// Get a single pixel color. Index is bounds-checked.
  RgbwColor GetPixel(uint16_t index) const {
    PW_CHECK_UINT_LT(index, kNumLeds, "Pixel index out of bounds");
    return static_cast<const Derived*>(this)->DoGetPixel(index);
  }

  /// Fill all pixels with the same color.
  void Fill(RgbwColor color) {
    for (uint16_t i = 0; i < kNumLeds; ++i) {
      static_cast<Derived*>(this)->DoSetPixel(i, color);
    }
  }

  /// Clear all pixels to black.
  void Clear() { Fill(RgbwColor::Black()); }

  /// Set global brightness (0-255). Applied during Show().
  void SetBrightness(uint8_t brightness) {
    static_cast<Derived*>(this)->DoSetBrightness(brightness);
  }

  /// Get current brightness setting.
  uint8_t brightness() const {
    return static_cast<const Derived*>(this)->DoBrightness();
  }

  /// Push pixel buffer to hardware. Returns immediately (DMA on hardware).
  pw::Status Show() { return static_cast<Derived*>(this)->DoShow(); }
};

}  // namespace maco::led
