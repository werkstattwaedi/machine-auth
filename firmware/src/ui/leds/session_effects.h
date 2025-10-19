#pragma once

#include "ui/leds/led_effect.h"
#include <memory>

namespace oww::ui::leds {

/**
 * @brief Breathing white effect for idle state
 *
 * Smooth breathing animation on NFC area LEDs (white color).
 * Sine wave modulation for natural breathing feel.
 */
class IdleBreathingEffect : public ILedEffect {
 public:
  /**
   * @param period_ms Time for one complete breath cycle (default: 2000ms)
   */
  explicit IdleBreathingEffect(uint16_t period_ms = 4000);

  std::array<LedColor, 16> GetLeds(
      std::chrono::time_point<std::chrono::steady_clock> animation_time) const override;

 private:
  uint16_t period_ms_;
};

/**
 * @brief Solid green effect for active state
 *
 * Solid green on NFC area LEDs to indicate active session.
 */
class ActiveSolidEffect : public ILedEffect {
 public:
  ActiveSolidEffect();

  std::array<LedColor, 16> GetLeds(
      std::chrono::time_point<std::chrono::steady_clock> animation_time) const override;
};

/**
 * @brief Blinking red effect for denied state
 *
 * Fast blinking red on NFC area LEDs to indicate access denied.
 */
class DeniedBlinkEffect : public ILedEffect {
 public:
  /**
   * @param period_ms Time for one complete blink cycle (default: 500ms)
   */
  explicit DeniedBlinkEffect(uint16_t period_ms = 500);

  std::array<LedColor, 16> GetLeds(
      std::chrono::time_point<std::chrono::steady_clock> animation_time) const override;

 private:
  uint16_t period_ms_;
};

}  // namespace oww::ui::leds
