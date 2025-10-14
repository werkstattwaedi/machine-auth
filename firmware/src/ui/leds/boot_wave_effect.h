#pragma once

#include "ui/leds/led_effect.h"
#include <memory>

namespace oww::ui::leds {

/**
 * @brief Create a boot wave effect
 *
 * Smooth upward wave animation on display ring LEDs.
 * Used during boot sequence with phase-specific colors.
 *
 * @param color Wave color
 * @param period_ms Time for one complete wave cycle (default: 1000ms)
 * @return LED effect function
 */
LedEffect CreateBootWaveEffect(const LedColor& color,
                                uint16_t period_ms = 1000);

}  // namespace oww::ui::leds
