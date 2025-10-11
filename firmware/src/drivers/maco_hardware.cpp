#include "drivers/maco_hardware.h"

namespace oww::hal {

MacoHardware::MacoHardware(Adafruit_NeoPixel* led_strip)
    : led_strip_(led_strip) {}

void MacoHardware::SetLED(uint8_t index, uint8_t r, uint8_t g, uint8_t b,
                          uint8_t w) {
  if (!led_strip_ || index >= led_strip_->numPixels()) return;
  led_strip_->setPixelColor(index, r, g, b, w);
}

void MacoHardware::ShowLEDs() {
  if (!led_strip_) return;
  led_strip_->show();
}

void MacoHardware::Beep(uint16_t frequency_hz, uint16_t duration_ms) {
  // TODO: Implement buzzer control
}

}  // namespace oww::hal
