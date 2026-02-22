// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <array>
#include <cstdint>

#include "maco_firmware/modules/led/led_driver.h"
#include "maco_firmware/targets/host/sdl_display_driver.h"
#include "pw_log/log.h"
#include "pw_status/status.h"

namespace maco::led {

/// SDL-based LED driver for host simulator.
/// Passes LED pixel state to the display driver for overlay rendering on the
/// device image. No separate LED window is created.
///
/// @tparam kNumLeds Number of LEDs to simulate (default 16).
template <uint16_t kNumLeds = 16>
class SdlLedDriver : public LedDriver<SdlLedDriver<kNumLeds>, kNumLeds> {
 public:
  using Base = LedDriver<SdlLedDriver<kNumLeds>, kNumLeds>;
  friend Base;

  explicit SdlLedDriver(maco::display::SdlDisplayDriver& display)
      : display_(display) {}

 private:
  pw::Status DoInit() {
    pixels_.fill(RgbwColor::Black());
    PW_LOG_INFO("SDL LED driver initialized: %u LEDs", kNumLeds);
    return pw::OkStatus();
  }

  void DoSetPixel(uint16_t index, RgbwColor color) { pixels_[index] = color; }
  RgbwColor DoGetPixel(uint16_t index) const { return pixels_[index]; }
  void DoSetBrightness(uint8_t b) { brightness_ = b; }
  uint8_t DoBrightness() const { return brightness_; }

  pw::Status DoShow() {
    display_.UpdateLedPixels(pixels_.data(), kNumLeds, brightness_);
    return pw::OkStatus();
  }

  std::array<RgbwColor, kNumLeds> pixels_{};
  uint8_t brightness_ = 255;
  maco::display::SdlDisplayDriver& display_;
};

}  // namespace maco::led
