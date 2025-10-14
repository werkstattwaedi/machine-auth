#pragma once

#include "ui/leds/led_effect.h"
#include "common/time.h"
#include <memory>
#include <chrono>
#include <mutex>

namespace oww::ui::leds {

/**
 * @brief Manages LED effects with smooth crossfading
 *
 * Runs effects independently of UI rendering. Handles transitions between
 * effects with configurable crossfade duration.
 *
 * Thread-safe: SetEffect() can be called from UI thread, rendering happens
 * on LED thread.
 */
class EffectManager {
 public:
  /**
   * @param crossfade_ms Default crossfade duration when changing effects
   */
  explicit EffectManager(uint16_t crossfade_ms = 500);

  /**
   * @brief Set new effect (thread-safe)
   *
   * If an effect is currently running, it will smoothly crossfade to the new
   * effect over the configured crossfade duration.
   *
   * @param effect New effect function to display
   * @param immediate If true, skip crossfade and switch immediately
   */
  void SetEffect(LedEffect effect, bool immediate = false);

  /**
   * @brief Get the managed effect function
   *
   * Returns a function that handles crossfading and effect lifecycle.
   *
   * @return Effect function with crossfading
   */
  LedEffect GetEffect();

 private:
  // Current effect state
  LedEffect current_effect_;
  std::chrono::time_point<std::chrono::steady_clock> current_start_time_;

  // Next effect (for crossfade)
  LedEffect next_effect_;
  std::chrono::time_point<std::chrono::steady_clock> transition_start_time_;

  uint16_t crossfade_ms_;

  // Mutex for thread-safe effect changes
  mutable std::mutex mutex_;

  // Helper: get crossfade progress (0.0 = old effect, 1.0 = new effect)
  float GetCrossfadeProgress() const;
};

}  // namespace oww::ui::leds
