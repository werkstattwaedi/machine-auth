// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include "maco_firmware/modules/led/led_driver.h"
#include "maco_firmware/modules/led_animator/led_animator.h"
#include "maco_firmware/modules/led_animator/waveform.h"

namespace maco::led_animator {

/// Button off.
inline ButtonConfig OffButton() {
  return {};  // Default: Black/kFixed
}

/// Solid color button.
inline ButtonConfig SolidButton(maco::led::RgbwColor color) {
  return {.waveform = Waveform{.shape = Waveform::Shape::kFixed, .color = color}};
}

/// Breathing button.
inline ButtonConfig BreathingButton(maco::led::RgbwColor color,
                                     float period_s = 2.0f,
                                     float min_brightness = 0.0f) {
  return {.waveform = Waveform{
              .shape = Waveform::Shape::kBreathing,
              .color = color,
              .period_s = period_s,
              .min_brightness = min_brightness,
          }};
}

/// Blinking button.
inline ButtonConfig BlinkingButton(maco::led::RgbwColor color,
                                    float period_s = 0.5f,
                                    float duty_cycle = 0.5f) {
  return {.waveform = Waveform{
              .shape = Waveform::Shape::kBlinking,
              .color = color,
              .period_s = period_s,
              .duty_cycle = duty_cycle,
          }};
}

}  // namespace maco::led_animator
