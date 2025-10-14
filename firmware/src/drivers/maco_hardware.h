#pragma once

#include "hal/hardware_interface.h"
#include "common.h"
#include "neopixel.h"
#include <memory>

namespace oww::hal {

/**
 * @brief MACO hardware implementation
 *
 * Wraps the Adafruit_NeoPixel strip to provide the IHardware interface.
 */
class MacoHardware : public IHardware {
 public:
  explicit MacoHardware(Adafruit_NeoPixel* led_strip);
  ~MacoHardware() override;

  // Set LED callback (runs on dedicated thread)
  void SetLedCallback(LedCallback callback) override;

  // Buzzer
  void Beep(uint16_t frequency_hz, uint16_t duration_ms) override;

 private:
  Adafruit_NeoPixel* led_strip_;

  // LED callback system
  LedCallback led_callback_;
  Thread* led_thread_ = nullptr;
  volatile bool led_thread_running_ = false;

  // Internal LED control (called by LED thread)
  void SetLED(uint8_t index, uint8_t r, uint8_t g, uint8_t b, uint8_t w = 0);
  void ShowLEDs();

  // LED thread function
  os_thread_return_t LEDThreadFunc();
};

}  // namespace oww::hal
