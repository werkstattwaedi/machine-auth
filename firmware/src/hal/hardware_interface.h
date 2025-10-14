#pragma once

#include <cstddef>
#include <cstdint>
#include <array>
#include <functional>
#include <chrono>

namespace oww::hal {

// LED color structure
struct LedColor {
  uint8_t r{0}, g{0}, b{0}, w{0};
  bool unspecified{false};  // If true, LED is not controlled by this effect

  static LedColor Off() { return {0, 0, 0, 0, false}; }
  static LedColor Unspecified() { return {0, 0, 0, 0, true}; }
};

/**
 * @brief Hardware abstraction interface
 *
 * Both firmware and simulator implement this interface to provide
 * hardware access. Allows UI code to run identically on both platforms.
 *
 * LED Layout (16 total, indices 0-15):
 *  - Buttons: 1, 4, 10, 11 (bottom_right, bottom_left, top_left, top_right)
 *  - NFC area: 2, 3
 *  - Display surround: 0, 5, 6, 7, 8, 9, 12, 13, 14, 15
 */
class IHardware {
 public:
  virtual ~IHardware() = default;

  // LED effect function signature
  // Takes animation time, returns all 16 LED colors
  using LedEffect = std::function<std::array<LedColor, 16>(
      std::chrono::time_point<std::chrono::steady_clock>)>;

  // Set LED effect (runs continuously on dedicated thread)
  // @param effect Function to call for LED updates (nullptr disables)
  virtual void SetLedCallback(LedEffect effect) = 0;

  // Buzzer
  virtual void Beep(uint16_t frequency_hz, uint16_t duration_ms) = 0;

 protected:
  // Alias for backwards compatibility in implementations
  using LedCallback = LedEffect;
};

}  // namespace oww::hal
