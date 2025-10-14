#pragma once

#include "ui/leds/led_effect.h"
#include "hal/led_layout.h"
#include <mutex>
#include <memory>

namespace oww::ui::leds {

/**
 * @brief Create a button bar LED effect
 *
 * Renders button LEDs based on button state (colors, enabled/disabled).
 * Returns a shared state object that can be updated from UI thread.
 */
class ButtonBarEffectState {
 public:
  ButtonBarEffectState();

  // Update button states (called from UI thread)
  void SetLeftButton(bool enabled, uint8_t r, uint8_t g, uint8_t b);
  void SetRightButton(bool enabled, uint8_t r, uint8_t g, uint8_t b);
  void SetUpButton(bool enabled);
  void SetDownButton(bool enabled);
  void ClearAll();

  // Get the effect function
  LedEffect GetEffect();

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
