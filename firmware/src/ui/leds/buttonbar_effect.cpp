#include "ui/leds/buttonbar_effect.h"

namespace oww::ui::leds {

ButtonBarEffect::ButtonBarEffect() = default;

void ButtonBarEffect::SetLeftButton(bool enabled, uint8_t r, uint8_t g,
                                     uint8_t b) {
  std::lock_guard<std::mutex> lock(mutex_);
  left_button_.enabled = enabled;
  left_button_.color = LedColor{r, g, b, 0, false};
}

void ButtonBarEffect::SetRightButton(bool enabled, uint8_t r, uint8_t g,
                                      uint8_t b) {
  std::lock_guard<std::mutex> lock(mutex_);
  right_button_.enabled = enabled;
  right_button_.color = LedColor{r, g, b, 0, false};
}

void ButtonBarEffect::SetUpButton(bool enabled) {
  std::lock_guard<std::mutex> lock(mutex_);
  up_button_.enabled = enabled;
  up_button_.color =
      LedColor{0, 0, 0, static_cast<uint8_t>(enabled ? 180 : 0), false};
}

void ButtonBarEffect::SetDownButton(bool enabled) {
  std::lock_guard<std::mutex> lock(mutex_);
  down_button_.enabled = enabled;
  down_button_.color =
      LedColor{0, 0, 0, static_cast<uint8_t>(enabled ? 180 : 0), false};
}

void ButtonBarEffect::ClearAll() {
  std::lock_guard<std::mutex> lock(mutex_);
  left_button_.enabled = false;
  left_button_.color = LedColor::Off();
  right_button_.enabled = false;
  right_button_.color = LedColor::Off();
  up_button_.enabled = false;
  up_button_.color = LedColor::Off();
  down_button_.enabled = false;
  down_button_.color = LedColor::Off();
}

std::array<LedColor, 16> ButtonBarEffect::GetLeds(
    std::chrono::time_point<std::chrono::steady_clock> animation_time) const {
  (void)animation_time;  // Not used for button bar

  std::lock_guard<std::mutex> lock(mutex_);
  std::array<LedColor, 16> result;
  result.fill(LedColor::Unspecified());

  using namespace hal::led_indices;

  // Set button LED colors
  result[BUTTON_BOTTOM_LEFT] =
      left_button_.enabled ? left_button_.color : LedColor::Off();
  result[BUTTON_BOTTOM_RIGHT] =
      right_button_.enabled ? right_button_.color : LedColor::Off();
  result[BUTTON_TOP_LEFT] =
      down_button_.enabled ? down_button_.color : LedColor::Off();
  result[BUTTON_TOP_RIGHT] =
      up_button_.enabled ? up_button_.color : LedColor::Off();

  return result;
}

}  // namespace oww::ui::leds
