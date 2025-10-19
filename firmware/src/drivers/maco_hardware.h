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
  explicit MacoHardware();
  ~MacoHardware() override;

  // Set LED callback (runs on dedicated thread)
  void SetLedEffect(std::shared_ptr<ILedEffect> callback) override;

  // Buzzer
  void Beep(uint16_t frequency_hz, uint16_t duration_ms) override;

 private:
  Adafruit_NeoPixel led_strip_;

  // LED callback system
  std::shared_ptr<ILedEffect> led_effect_;
  Thread* led_thread_ = nullptr;
  volatile bool led_thread_running_ = false;

  // LED thread function
  os_thread_return_t LEDThreadFunc();
};

}  // namespace oww::hal
