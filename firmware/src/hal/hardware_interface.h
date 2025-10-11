#pragma once

#include <cstddef>
#include <cstdint>

namespace oww::hal {

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

  // Set individual LED (0-15)
  virtual void SetLED(uint8_t index, uint8_t r, uint8_t g, uint8_t b,
                      uint8_t w = 0) = 0;

  // Push all LED changes to hardware/display
  virtual void ShowLEDs() = 0;

  // Buzzer
  virtual void Beep(uint16_t frequency_hz, uint16_t duration_ms) = 0;
};

}  // namespace oww::hal
