#pragma once

#include "ui/leds/led_effect.h"
#include <vector>
#include <mutex>
#include <memory>

namespace oww::ui::leds {

/**
 * @brief Multiplexes multiple LED effects with priority ordering
 *
 * Combines multiple effects by priority. For each LED:
 * - First non-unspecified color from the effect list is used
 * - If all effects return unspecified, LED is turned off
 *
 * Thread-safe for adding/clearing effects from UI thread while
 * rendering from LED thread.
 */
class Multiplexer {
 public:
  Multiplexer() = default;

  /**
   * @brief Add an effect to the multiplexer (higher priority first)
   * @param effect The effect function to add
   */
  void AddEffect(LedEffect effect);

  /**
   * @brief Clear all effects
   */
  void Clear();

  /**
   * @brief Get the multiplexed LED effect function
   * @return Function that combines all added effects
   */
  LedEffect GetEffect();

 private:
  std::vector<LedEffect> effects_;
  mutable std::mutex mutex_;
};

}  // namespace oww::ui::leds
