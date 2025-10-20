#pragma once

#include "ui/leds/led_effect.h"
#include "common/time.h"
#include <memory>
#include <chrono>

namespace oww::ui::leds {

/**
 * @brief Manages LED effect with smooth crossfading
 *
 * Simple crossfader that blends between old and new effects.
 * Not thread-safe - caller must handle synchronization.
 */
class Crossfade : public ILedEffect {
 public:
  /**
   * @param crossfade_ms Default crossfade duration when changing effects
   */
  explicit Crossfade(uint16_t crossfade_ms = 500);

  /**
   * @brief Set new effect
   *
   * If an effect is currently running, it will smoothly crossfade to the new
   * effect over the configured crossfade duration.
   *
   * @param effect New effect to display (can be nullptr)
   * @param immediate If true, skip crossfade and switch immediately
   */
  void SetEffect(std::shared_ptr<ILedEffect> effect, bool immediate = false);

  // ILedEffect interface
  std::array<LedColor, 16> GetLeds(
      std::chrono::time_point<std::chrono::steady_clock> animation_time) const override;

 private:
  // Current effect state
  std::shared_ptr<ILedEffect> current_effect_;
  std::chrono::time_point<std::chrono::steady_clock> current_start_time_;

  // Next effect (for crossfade)
  std::shared_ptr<ILedEffect> next_effect_;
  std::chrono::time_point<std::chrono::steady_clock> transition_start_time_;

  uint16_t crossfade_ms_;

  // Helper: get crossfade progress (0.0 = old effect, 1.0 = new effect)
  float GetCrossfadeProgress() const;
};

}  // namespace oww::ui::leds
