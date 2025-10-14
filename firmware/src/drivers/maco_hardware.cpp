#include "drivers/maco_hardware.h"
#include "drivers/maco_watchdog.h"
#include "common/time.h"
#include <chrono>

namespace oww::hal {

// LED thread priority and stack size
constexpr os_thread_prio_t kLedThreadPriority = OS_THREAD_PRIORITY_DEFAULT;
constexpr size_t kLedThreadStackSize = 2048;
constexpr size_t kNumLeds = 16;

MacoHardware::MacoHardware(Adafruit_NeoPixel* led_strip)
    : led_strip_(led_strip) {
  // Start LED thread
  led_thread_running_ = true;
  led_thread_ = new Thread(
      "LEDs", [this]() { return LEDThreadFunc(); },
      kLedThreadPriority, kLedThreadStackSize);
}

void MacoHardware::SetLED(uint8_t index, uint8_t r, uint8_t g, uint8_t b,
                          uint8_t w) {
  if (!led_strip_ || index >= led_strip_->numPixels()) return;
  led_strip_->setPixelColor(index, r, g, b, w);
}

void MacoHardware::ShowLEDs() {
  if (!led_strip_) return;
  led_strip_->show();
}

void MacoHardware::SetLedCallback(LedCallback callback) {
  led_callback_ = callback;
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
  constexpr auto kFrameTime = std::chrono::milliseconds(16);  // ~60fps

  while (led_thread_running_) {
    auto frame_start = timeSinceBoot();

    // Ping watchdog
    drivers::MacoWatchdog::instance().Ping(drivers::ObservedThread::kLed);

    // Render all LEDs using callback
    if (led_callback_ && led_strip_) {
      auto colors = led_callback_(frame_start);
      for (uint8_t i = 0; i < kNumLeds && i < colors.size(); i++) {
        SetLED(i, colors[i].r, colors[i].g, colors[i].b, colors[i].w);
      }
      ShowLEDs();
    }

    // Maintain frame rate
    auto frame_end = timeSinceBoot();
    auto frame_duration = std::chrono::duration_cast<std::chrono::milliseconds>(
        frame_end - frame_start);
    auto sleep_time = kFrameTime - frame_duration;

    if (sleep_time > std::chrono::milliseconds(0)) {
      delay(sleep_time.count());
    }
  }
}

}  // namespace oww::hal
