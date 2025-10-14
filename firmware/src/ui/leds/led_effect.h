#pragma once

#include "hal/hardware_interface.h"
#include <chrono>
#include <array>

namespace oww::ui::leds {

using hal::LedColor;
using hal::IHardware;

// Blend two colors by factor (0.0 = color a, 1.0 = color b)
LedColor BlendColors(const LedColor& a, const LedColor& b, float factor);

// LED effect function type (returns all 16 LED colors)
using LedEffect = IHardware::LedEffect;

}  // namespace oww::ui::leds
