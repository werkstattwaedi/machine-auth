// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include "maco_firmware/modules/led/led_driver.h"
#include "maco_firmware/modules/led_animator/led_animator.h"
#include "maco_firmware/modules/led_animator/waveform.h"

namespace maco::led_animator {

/// All ring LEDs off.
inline AmbientEffect OffAmbient() {
  return {};  // Default-constructed: all Black/kFixed, no motion
}

/// Uniform breathing ring: all 10 hotspots at fixed integer positions.
inline AmbientEffect BreathingAmbient(maco::led::RgbwColor color,
                                       float period_s = 2.0f,
                                       float min_brightness = 0.0f) {
  AmbientEffect effect;
  Waveform w{
      .shape = Waveform::Shape::kBreathing,
      .color = color,
      .period_s = period_s,
      .min_brightness = min_brightness,
  };
  for (int h = 0; h < 10; ++h) {
    effect.hotspots[h] = HotspotConfig{
        .waveform = w,
        .start_position = static_cast<float>(h),
    };
  }
  return effect;
}

/// Evenly-spaced hotspots rotating clockwise around the ring.
/// @param speed         Ring positions/second (positive = clockwise)
/// @param num_hotspots  Number of hotspots, evenly spaced (1–10)
inline AmbientEffect RotatingAmbient(maco::led::RgbwColor color,
                                      float speed,
                                      int num_hotspots = 2) {
  if (num_hotspots < 1) num_hotspots = 1;
  if (num_hotspots > 10) num_hotspots = 10;
  AmbientEffect effect;  // Unused slots default to Black/kFixed
  const float spacing = 10.0f / static_cast<float>(num_hotspots);
  for (int h = 0; h < num_hotspots; ++h) {
    effect.hotspots[h] = HotspotConfig{
        .waveform = Waveform{.shape = Waveform::Shape::kFixed, .color = color},
        .start_position = h * spacing,
        .velocity = speed,
    };
  }
  return effect;
}

}  // namespace maco::led_animator
