#pragma once

#include "ui/leds/led_effect.h"
#include <mutex>
#include <memory>

namespace oww::ui::leds {

/**
 * @brief Button bar LED effect
 *
 * Renders button LEDs based on button state (colors, enabled/disabled).
 * Thread-safe for updates from UI thread and rendering from LED thread.
 */
class ButtonBarEffect : public ILedEffect {
 public:
  ButtonBarEffect();

  // Update button states (called from UI thread)
  void SetLeftButton(bool enabled, uint8_t r, uint8_t g, uint8_t b);
  void SetRightButton(bool enabled, uint8_t r, uint8_t g, uint8_t b);
  void SetUpButton(bool enabled);
  void SetDownButton(bool enabled);
  void ClearAll();

  // ILedEffect interface
  std::array<LedColor, 16> GetLeds(
      std::chrono::time_point<std::chrono::steady_clock> animation_time) const override;

 private:
  mutable std::mutex mutex_;

  struct ButtonState {
    bool enabled{false};
    LedColor color{0, 0, 0, 0};
  };

  ButtonState left_button_;
  ButtonState right_button_;
  ButtonState up_button_;    // White LED
  ButtonState down_button_;  // White LED
};

}  // namespace oww::ui::leds
