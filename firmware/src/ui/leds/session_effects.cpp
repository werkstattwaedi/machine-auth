#include "ui/leds/session_effects.h"

#include <cmath>

namespace oww::ui::leds {

static constexpr uint8_t kRingIndices[] = {0, 15, 14, 13, 12, 9, 8, 7, 6, 5};
static constexpr size_t kRingCount = 10;

// Idle: Breathing white on NFC area
IdleBreathingEffect::IdleBreathingEffect(uint16_t period_ms)
    : period_ms_(period_ms) {}

std::array<LedColor, 16> IdleBreathingEffect::GetLeds(
    std::chrono::time_point<std::chrono::steady_clock> animation_time) const {
  std::array<LedColor, 16> leds = {};

  // Calculate breathing intensity using sine wave (0.0 to 1.0)
  auto millis = std::chrono::duration_cast<std::chrono::milliseconds>(
                    animation_time.time_since_epoch())
                    .count();
  float phase = (millis % period_ms_) / static_cast<float>(period_ms_);
  float intensity = (std::sin(phase * 2.0f * M_PI - M_PI / 2.0f) + 1.0f) / 2.0f;

  // Map to brightness range (20% to 100% for subtle breathing)
  uint8_t brightness = static_cast<uint8_t>(20 + intensity * 80);

  // Apply to NFC area LEDs
  for (size_t ring_index = 0; ring_index < kRingCount; ring_index++) {
    uint8_t led_index = kRingIndices[ring_index];
    leds[led_index] = LedColor{0, 0, 0, brightness};
  }

  return leds;
}

// Active: Solid green on NFC area
ActiveSolidEffect::ActiveSolidEffect() {}

std::array<LedColor, 16> ActiveSolidEffect::GetLeds(
    std::chrono::time_point<std::chrono::steady_clock> animation_time) const {
  std::array<LedColor, 16> leds = {};

  // Solid green at full brightness
  for (size_t ring_index = 0; ring_index < kRingCount; ring_index++) {
    uint8_t led_index = kRingIndices[ring_index];
    leds[led_index] = LedColor{0, 255, 0, 0};
  }

  return leds;
}

// Denied: Blinking red on NFC area
DeniedBlinkEffect::DeniedBlinkEffect(uint16_t period_ms)
    : period_ms_(period_ms) {}

std::array<LedColor, 16> DeniedBlinkEffect::GetLeds(
    std::chrono::time_point<std::chrono::steady_clock> animation_time) const {
  std::array<LedColor, 16> leds = {};

  // Calculate blink state (on/off)
  auto millis = std::chrono::duration_cast<std::chrono::milliseconds>(
                    animation_time.time_since_epoch())
                    .count();
  bool is_on = (millis % period_ms_) < (period_ms_ / 2);

  // Blink red on NFC area
  LedColor color = is_on ? LedColor{255, 0, 0, 0} : LedColor{0, 0, 0, 0};

  for (size_t ring_index = 0; ring_index < kRingCount; ring_index++) {
    uint8_t led_index = kRingIndices[ring_index];
    leds[led_index] = color;
  }

  return leds;
}

}  // namespace oww::ui::leds
