// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include "maco_firmware/modules/led/led_driver.h"
#include "maco_firmware/modules/led_animator/led_animator.h"
#include "maco_firmware/modules/led_animator/waveform.h"

namespace maco::led_animator {

static constexpr float kPi = 3.14159265f;

/// All ring LEDs off.
inline AmbientEffect OffAmbient() {
  return {};  // Default-constructed: all Black/kFixed, no motion
}

inline AmbientEffect BlinkAmbient(
    maco::led::RgbwColor color,
    float period_s = 0.75f,
    float min_brightness = 0.2f
) {
  AmbientEffect effect;

  effect.hotspots[0] = HotspotConfig{
      .waveform =
          {
              .shape = Waveform::Shape::kBlinking,
              .color = color,
              .period_s = period_s,
              .min_brightness = min_brightness,
          },
      .start_position = kPi,  // anchor at bottom-left
      .velocity = 0,
      .radius = kPi * 2,
      .falloff_shape = 0,
  };
  return effect;
}

/// Uniform breathing ring: all 10 hotspots at fixed integer positions.
inline AmbientEffect BreathingAmbient(
    maco::led::RgbwColor color,
    float period_s = 2.0f,
    float min_brightness = 0.0f
) {
  AmbientEffect effect;

  effect.hotspots[0] = HotspotConfig{
      .waveform =
          {
              .shape = Waveform::Shape::kBreathing,
              .color = color,
              .period_s = period_s,
              .min_brightness = min_brightness,
          },
      .start_position = kPi,  // anchor at bottom-left
      .velocity = 0,
      .radius = kPi * 2,
      .falloff_shape = 0,
  };
  return effect;
}

/// Evenly-spaced hotspots rotating clockwise around the ring.
/// @param speed         Ring positions/second (positive = clockwise)
/// @param num_hotspots  Number of hotspots, evenly spaced (1–10)
inline AmbientEffect RotatingAmbient(
    maco::led::RgbwColor color,
    float speed,
    int num_hotspots = 2,
    float radius = 1.0f,
    float falloff_shape = 1.0f
) {
  if (num_hotspots < 1)
    num_hotspots = 1;
  if (num_hotspots > 10)
    num_hotspots = 10;
  AmbientEffect effect;  // Unused slots default to Black/kFixed
  const float spacing = 2 * kPi / static_cast<float>(num_hotspots);
  for (int h = 0; h < num_hotspots; ++h) {
    effect.hotspots[h] = HotspotConfig{
        .waveform = Waveform{.shape = Waveform::Shape::kFixed, .color = color},
        .start_position = h * spacing,
        .velocity = speed,
        .radius = radius,
        .falloff_shape = falloff_shape
    };
  }
  return effect;
}

inline AmbientEffect UpwardAmbient(maco::led::RgbwColor color, float speed) {
  AmbientEffect effect;  // Unused slots default to Black/kFixed

  effect.hotspots[0] = HotspotConfig{
      .waveform = Waveform{.shape = Waveform::Shape::kFixed, .color = color},
      .start_position = kPi,  // anchor at bottom
      .velocity = speed,
      .radius = kPi / 2,
      .falloff_shape = 3.0f,
      .sweep_arc = kPi,  // half-circle clockwise
      .return_multiplier = .2f
  };

  effect.hotspots[2] = HotspotConfig{
      .waveform = Waveform{.shape = Waveform::Shape::kFixed, .color = color},
      .start_position = kPi,  // anchor at bottom
      .velocity = -speed,
      .radius = kPi / 2,
      .falloff_shape = 3.0f,
      .sweep_arc = -kPi,  // half-circle counterclockwise
      .return_multiplier = .2f
  };

  effect.hotspots[3] = HotspotConfig{
      .waveform =
          Waveform{
              .shape = Waveform::Shape::kFixed,
              .color =
                  maco::led::RgbwColor{
                      0,
                      0,
                      0,
                      32,
                  }
          },
      .start_position = 0,  // anchor at bottom-left
      .velocity = 0,
      .radius = kPi * 2,
      .falloff_shape = 0,
  };

  return effect;
}

}  // namespace maco::led_animator
