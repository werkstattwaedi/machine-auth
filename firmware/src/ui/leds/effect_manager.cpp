#include "ui/leds/effect_manager.h"

#include "common/time.h"

namespace oww::ui::leds {

EffectManager::EffectManager(uint16_t crossfade_ms)
    : current_effect_(nullptr),
      current_start_time_(timeSinceBoot()),
      next_effect_(nullptr),
      crossfade_ms_(crossfade_ms) {}

void EffectManager::SetEffect(LedEffect effect, bool immediate) {
  std::lock_guard<std::mutex> lock(mutex_);

  if (immediate || !current_effect_) {
    // Immediate switch or no current effect
    current_effect_ = effect;
    current_start_time_ = timeSinceBoot();
    next_effect_ = nullptr;
  } else {
    // Crossfade to new effect
    next_effect_ = effect;
    transition_start_time_ = timeSinceBoot();
  }
}

float EffectManager::GetCrossfadeProgress() const {
  if (!next_effect_) {
    return 0.0f;  // No transition in progress
  }

  auto now = timeSinceBoot();
  auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(
      now - transition_start_time_);

  if (elapsed.count() >= crossfade_ms_) {
    return 1.0f;  // Transition complete
  }

  return elapsed.count() / static_cast<float>(crossfade_ms_);
}

LedEffect EffectManager::GetEffect() {
  // Return lambda that handles crossfading
  return
      [this](std::chrono::time_point<std::chrono::steady_clock> animation_time)
          -> std::array<LedColor, 16> {
        std::lock_guard<std::mutex> lock(mutex_);

        // Check if transition is complete
        if (next_effect_) {
          float progress = GetCrossfadeProgress();
          if (progress >= 1.0f) {
            // Transition complete - promote next to current
            current_effect_ = next_effect_;
            current_start_time_ = timeSinceBoot();
            next_effect_ = nullptr;
          }
        }

        // No effect active - return all off
        if (!current_effect_) {
          std::array<LedColor, 16> result;
          result.fill(LedColor::Off());
          return result;
        }

        // Get current effect colors
        auto colors = current_effect_(animation_time);

        // Apply crossfade if transitioning
        if (next_effect_) {
          float progress = GetCrossfadeProgress();
          auto next_colors = next_effect_(animation_time);

          // Blend all LED colors
          for (uint8_t i = 0; i < 16; i++) {
            colors[i] = BlendColors(colors[i], next_colors[i], progress);
          }
        }

        return colors;
      };
}

}  // namespace oww::ui::leds
