#pragma once

#include "ui/leds/led_effect.h"
#include <memory>

namespace oww::ui::leds {

/**
 * @brief Boot wave effect - smooth upward wave on display ring LEDs
 *
 * Physics-based wave that travels upward with smooth fade-in/fade-out.
 * Used during boot sequence with phase-specific colors.
 */
class BootWaveEffect : public ILedEffect {
 public:
  /**
   * @param color Wave color
   * @param period_ms Time for one complete wave cycle (default: 1000ms)
   */
  explicit BootWaveEffect(const LedColor& color, uint16_t period_ms = 1000);

  // ILedEffect interface
  std::array<LedColor, 16> GetLeds(
      std::chrono::time_point<std::chrono::steady_clock> animation_time) const override;

 private:
  LedColor color_;
  uint16_t period_ms_;

  // LED ring indices (display surround, ordered for animation)
  static constexpr uint8_t kRingIndices[] = {0, 15, 14, 13, 12, 9, 8, 7, 6, 5};
  static constexpr size_t kRingCount = 10;

  // Helper: get normalized position for LED (0=bottom, 1=top)
  static float GetLedPosition(uint8_t array_index);
};

}  // namespace oww::ui::leds
