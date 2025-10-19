#include "ui/leds/multiplexer.h"

namespace oww::ui::leds {

void Multiplexer::SetEffects(
    const std::vector<std::shared_ptr<ILedEffect>>& effects) {
  effects_ = effects;
}

std::array<LedColor, 16> Multiplexer::GetLeds(
    std::chrono::time_point<std::chrono::steady_clock> animation_time) const {
  std::array<LedColor, 16> result;
  result.fill(LedColor::Unspecified());

  // For each LED, find first non-unspecified color from effects
  for (uint8_t led = 0; led < 16; led++) {
    for (const auto& effect : effects_) {
      if (!effect) continue;

      auto colors = effect->GetLeds(animation_time);
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
}

}  // namespace oww::ui::leds
