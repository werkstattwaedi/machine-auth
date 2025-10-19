#include "drivers/maco_hardware.h"

#include <chrono>
#include <iostream>
#include <sstream>

#include "common/time.h"
#include "config.h"
#include "drivers/maco_watchdog.h"
#include "hal/led_effect.h"

namespace oww::hal {

MacoHardware::MacoHardware()
    : led_strip_(config::led::pixel_count, SPI, config::led::pixel_type) {
  // Start LED thread

  led_strip_.show();

  led_thread_running_ = true;
  led_thread_ = new Thread(
      "LEDs", [this]() { return LEDThreadFunc(); },
      config::led::thread_priority, config::led::thread_stack_size);
}

void MacoHardware::SetLedEffect(std::shared_ptr<ILedEffect> led_effect) {
  led_effect_ = led_effect;
}

void MacoHardware::Beep(uint16_t frequency_hz, uint16_t duration_ms) {
  // TODO: Implement buzzer control
}

MacoHardware::~MacoHardware() {
  // Signal thread to stop
  led_thread_running_ = false;

  // Wait for thread to finish (with timeout)
  if (led_thread_) {
    // Particle Thread doesn't have join(), so we just delete it
    // The OS will clean up the thread
    delete led_thread_;
    led_thread_ = nullptr;
  }
}

os_thread_return_t MacoHardware::LEDThreadFunc() {
  while (led_thread_running_) {
    auto frame_start = timeSinceBoot();

    // Ping watchdog
    drivers::MacoWatchdog::instance().Ping(drivers::ObservedThread::kLed);

    // Render all LEDs using callback
    if (!led_effect_) {
      delay(config::led::target_frame_time);
      continue;
    }
    auto colors = led_effect_->GetLeds(frame_start);
    for (uint8_t i = 0; i < config::led::pixel_count && i < colors.size();
         i++) {
      auto color = colors[i];
      if (color.unspecified) continue;
      led_strip_.setPixelColor(i, color.r, color.g, color.b, color.w);
    }

    // Note: calling show on the LEDs takes roghly 5ms
    led_strip_.show();

    // Maintain frame rate
    auto frame_end = timeSinceBoot();
    auto frame_duration = std::chrono::duration_cast<std::chrono::milliseconds>(
        frame_end - frame_start);
    auto sleep_time = config::led::target_frame_time - frame_duration;

    if (sleep_time > std::chrono::milliseconds(0)) {
      delay(sleep_time);
    }
  }
}

}  // namespace oww::hal
