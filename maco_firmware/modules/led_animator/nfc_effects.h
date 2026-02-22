// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include "maco_firmware/modules/led/led_driver.h"
#include "maco_firmware/modules/led_animator/led_animator.h"
#include "maco_firmware/modules/led_animator/waveform.h"

namespace maco::led_animator {

/// NFC LEDs off.
inline Waveform OffNfc() {
  return {};  // Default: Black/kFixed
}

/// Solid color NFC LEDs.
inline Waveform SolidNfc(maco::led::RgbwColor color) {
  return {.shape = Waveform::Shape::kFixed, .color = color};
}

/// Breathing NFC LEDs.
inline Waveform BreathingNfc(maco::led::RgbwColor color,
                              float period_s = 2.0f,
                              float min_brightness = 0.0f) {
  return {
      .shape = Waveform::Shape::kBreathing,
      .color = color,
      .period_s = period_s,
      .min_brightness = min_brightness,
  };
}

/// Blinking NFC LEDs.
inline Waveform BlinkingNfc(maco::led::RgbwColor color,
                             float period_s = 0.5f,
                             float duty_cycle = 0.5f) {
  return {
      .shape = Waveform::Shape::kBlinking,
      .color = color,
      .period_s = period_s,
      .duty_cycle = duty_cycle,
  };
}

}  // namespace maco::led_animator
