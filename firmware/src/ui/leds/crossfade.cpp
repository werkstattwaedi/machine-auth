#include "ui/leds/crossfade.h"
#include "common/time.h"

namespace oww::ui::leds {

Crossfade::Crossfade(uint16_t crossfade_ms)
    : current_effect_(nullptr),
      current_start_time_(timeSinceBoot()),
      next_effect_(nullptr),
      crossfade_ms_(crossfade_ms) {}

void Crossfade::SetEffect(std::shared_ptr<ILedEffect> effect,
                               bool immediate) {
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

float Crossfade::GetCrossfadeProgress() const {
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

std::array<LedColor, 16> Crossfade::GetLeds(
    std::chrono::time_point<std::chrono::steady_clock> animation_time) const {
  // Check if transition is complete (mutable state update)
  if (next_effect_) {
    float progress = GetCrossfadeProgress();
    if (progress >= 1.0f) {
      // Transition complete - promote next to current
      // NOTE: This is mutable state modification, but safe because
      // Crossfade is only called from one thread (LED thread via UiManager)
      const_cast<Crossfade*>(this)->current_effect_ = next_effect_;
      const_cast<Crossfade*>(this)->current_start_time_ = timeSinceBoot();
      const_cast<Crossfade*>(this)->next_effect_ = nullptr;
    }
  }

  // No effect active - return all off
  if (!current_effect_) {
    std::array<LedColor, 16> result;
    result.fill(LedColor::Off());
    return result;
  }

  // Get current effect colors
  auto colors = current_effect_->GetLeds(animation_time);

  // Apply crossfade if transitioning
  if (next_effect_) {
    float progress = GetCrossfadeProgress();
    auto next_colors = next_effect_->GetLeds(animation_time);

    // Blend all LED colors
    for (uint8_t i = 0; i < 16; i++) {
      colors[i] = BlendColors(colors[i], next_colors[i], progress);
    }
  }

  return colors;
}

}  // namespace oww::ui::leds
