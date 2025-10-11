#pragma once

#include "hal/hardware_interface.h"
#include "neopixel.h"

namespace oww::hal {

/**
 * @brief MACO hardware implementation
 *
 * Wraps the Adafruit_NeoPixel strip to provide the IHardware interface.
 */
class MacoHardware : public IHardware {
 public:
  explicit MacoHardware(Adafruit_NeoPixel* led_strip);
  ~MacoHardware() override = default;

  // Set individual LED (0-15)
  void SetLED(uint8_t index, uint8_t r, uint8_t g, uint8_t b,
              uint8_t w = 0) override;

  // Push all LED changes to hardware
  void ShowLEDs() override;

  // Buzzer
  void Beep(uint16_t frequency_hz, uint16_t duration_ms) override;

 private:
  Adafruit_NeoPixel* led_strip_;
};

}  // namespace oww::hal
