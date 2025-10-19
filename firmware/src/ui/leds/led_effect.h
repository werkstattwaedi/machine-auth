#pragma once

#include "hal/led_effect.h"

namespace oww::ui::leds {

// Re-export HAL types for convenience
using hal::ILedEffect;
using hal::LedColor;

// Blend two colors by factor (0.0 = color a, 1.0 = color b)
LedColor BlendColors(const LedColor& a, const LedColor& b, float factor);

}  // namespace oww::ui::leds
