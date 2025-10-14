#include "ui/leds/multiplexer.h"

namespace oww::ui::leds {

void Multiplexer::AddEffect(LedEffect effect) {
  std::lock_guard<std::mutex> lock(mutex_);
  if (effect) {
    effects_.push_back(effect);
  }
}

void Multiplexer::Clear() {
  std::lock_guard<std::mutex> lock(mutex_);
  effects_.clear();
}

LedEffect Multiplexer::GetEffect() {
  // Capture effects by value to avoid lifetime issues
  return [this](std::chrono::time_point<std::chrono::steady_clock>
                    animation_time) -> std::array<LedColor, 16> {
    std::lock_guard<std::mutex> lock(mutex_);

    std::array<LedColor, 16> result;
    result.fill(LedColor::Unspecified());

    // For each LED, find first non-unspecified color from effects
    for (uint8_t led = 0; led < 16; led++) {
      for (const auto& effect : effects_) {
        if (!effect) continue;

        auto colors = effect(animation_time);
        if (!colors[led].unspecified) {
          result[led] = colors[led];
          break;  // Found non-unspecified color, use it
        }
      }

      // If all effects returned unspecified, turn LED off
      if (result[led].unspecified) {
        result[led] = LedColor::Off();
      }
    }

    return result;
  };
}

}  // namespace oww::ui::leds
