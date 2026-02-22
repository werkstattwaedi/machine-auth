// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <cmath>
#include <cstdint>

#include "maco_firmware/modules/led/led_driver.h"

namespace maco::led_animator {

/// Time-varying color pattern for a single LED zone.
/// Evaluate(t) returns the instantaneous color at normalized time t in [0, 1).
struct Waveform {
  enum class Shape { kFixed, kBreathing, kBlinking };

  Shape shape = Shape::kFixed;
  maco::led::RgbwColor color;    // Peak/on color
  float period_s = 2.0f;         // Cycle length (breathing/blinking)
  float duty_cycle = 0.5f;       // Fraction of period that is "on" (blinking)
  float min_brightness = 0.0f;   // Trough brightness at breathing minimum (0 = fully off)

  /// Returns color at normalized time t ∈ [0, 1).
  maco::led::RgbwColor Evaluate(float t) const {
    switch (shape) {
      case Shape::kFixed:
        return color;

      case Shape::kBreathing: {
        // Cosine wave: t=0 → peak, t=0.5 → trough, t=1 → peak.
        float b = min_brightness +
                  (1.0f - min_brightness) *
                      (0.5f + 0.5f * std::cos(2.0f * kPi * t));
        return ScaleColor(color, b);
      }

      case Shape::kBlinking:
        return (t < duty_cycle) ? color : maco::led::RgbwColor::Black();
    }
    return maco::led::RgbwColor::Black();
  }

 private:
  static constexpr float kPi = 3.14159265358979f;

  static maco::led::RgbwColor ScaleColor(maco::led::RgbwColor c, float s) {
    return {
        static_cast<uint8_t>(c.r * s),
        static_cast<uint8_t>(c.g * s),
        static_cast<uint8_t>(c.b * s),
        static_cast<uint8_t>(c.w * s),
    };
  }
};

}  // namespace maco::led_animator
