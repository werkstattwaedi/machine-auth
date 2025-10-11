#pragma once

#include <cstdint>
#include <cstddef>

namespace oww::hal {

// Color structure matching the firmware LED controller
struct Color {
  uint8_t r{0}, g{0}, b{0}, w{0};

  static Color Off() { return {}; }
  static Color RGB(uint8_t r, uint8_t g, uint8_t b, uint8_t w = 0) {
    return Color{r, g, b, w};
  }
};

// Button bitmask
enum ButtonMask : uint8_t {
  BUTTON_NONE = 0,
  BUTTON_TOP_LEFT = (1 << 0),
  BUTTON_TOP_RIGHT = (1 << 1),
  BUTTON_BOTTOM_LEFT = (1 << 2),
  BUTTON_BOTTOM_RIGHT = (1 << 3),
};

/**
 * @brief Hardware abstraction interface
 *
 * Both firmware and simulator implement this interface to provide
 * hardware access. Allows UI code to run identically on both platforms.
 *
 * LED Layout (16 total, indices 0-15):
 *  - Buttons: 1, 4, 10, 11
 *  - NFC area: 2, 3
 *  - Display surround: 0, 5, 6, 7, 8, 9, 12, 13, 14, 15
 */
class IHardware {
 public:
  virtual ~IHardware() = default;

  // Set individual LED (0-15)
  virtual void SetLED(uint8_t index, uint8_t r, uint8_t g, uint8_t b, uint8_t w = 0) = 0;

  // Push all LED changes to hardware/display
  virtual void ShowLEDs() = 0;

  // Buttons - returns bitmask of currently pressed buttons
  virtual uint8_t GetButtonState() = 0;

  // Buzzer
  virtual void Beep(uint16_t frequency_hz, uint16_t duration_ms) = 0;

  // For simulator testing - simulate NFC tag present
  virtual void SimulateNFCTag(const uint8_t* uid, size_t len) {}
};

}  // namespace oww::hal
