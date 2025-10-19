#pragma once

#include "ui/leds/led_effect.h"
#include <vector>
#include <memory>

namespace oww::ui::leds {

/**
 * @brief Multiplexes multiple LED effects with priority ordering
 *
 * Combines multiple effects by priority. For each LED:
 * - First non-unspecified color from the effect list is used
 * - If all effects return unspecified, LED is turned off
 *
 * Thread-safe: holds shared_ptr refs to effects.
 */
class Multiplexer : public ILedEffect {
 public:
  Multiplexer() = default;

  /**
   * @brief Set the effects to multiplex (higher priority first)
   * @param effects Vector of effects (first = highest priority)
   */
  void SetEffects(const std::vector<std::shared_ptr<ILedEffect>>& effects);

  // ILedEffect interface
  std::array<LedColor, 16> GetLeds(
      std::chrono::time_point<std::chrono::steady_clock> animation_time) const override;

 private:
  std::vector<std::shared_ptr<ILedEffect>> effects_;
};

}  // namespace oww::ui::leds
