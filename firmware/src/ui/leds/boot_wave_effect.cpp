#include "ui/leds/boot_wave_effect.h"
#include <cmath>

namespace oww::ui::leds {

// LED ring indices (display surround, ordered for animation)
static constexpr uint8_t kRingIndices[] = {0, 15, 14, 13, 12, 9, 8, 7, 6, 5};
static constexpr size_t kRingCount = 10;

// Helper: get normalized position for LED (0=bottom, 1=top)
static float GetLedPosition(uint8_t array_index) {
  if (array_index < 5) {
    // Right side (array indices 0-4): bottom to top
    return array_index / 4.0f;
  } else {
    // Left side (array indices 5-9): physically numbered top to bottom
    // Invert to make upward movement match right side
    return 1.0f - ((array_index - 5) / 4.0f);
  }
}

LedEffect CreateBootWaveEffect(const LedColor& color, uint16_t period_ms) {
  // Capture by value to avoid lifetime issues
  return [color, period_ms](std::chrono::time_point<std::chrono::steady_clock>
                                 animation_time) -> std::array<LedColor, 16> {
    std::array<LedColor, 16> result;
    result.fill(LedColor::Unspecified());

    // Convert animation time to milliseconds
    auto time_ms = std::chrono::duration_cast<std::chrono::milliseconds>(
        animation_time.time_since_epoch());

    // Animation progress (0..1 over period)
    float t =
        (time_ms.count() % period_ms) / static_cast<float>(period_ms);

    // Physics-based easing: smoothstep for acceleration/deceleration
    float eased_t = t * t * (3.0f - 2.0f * t);

    // Extend range for smooth fade-in/fade-out
    // Wave width is 0.5, so we need margin on each side
    const float start_offset = -0.3f;
    const float end_offset = 1.3f;
    float wave_position = start_offset + eased_t * (end_offset - start_offset);

    // Calculate color for each LED in the ring
    for (size_t ring_index = 0; ring_index < kRingCount; ring_index++) {
      uint8_t led_index = kRingIndices[ring_index];

      // Get this LED's position (0=bottom, 1=top)
      float led_position = GetLedPosition(ring_index);

      // Calculate distance from wave center
      float distance = led_position - wave_position;

      // Wave profile: smooth bell curve using cosine
      const float wave_width = 0.5f;
      float normalized_dist = distance / wave_width;

      // Compute brightness
      float brightness = 0.0f;
      if (fabsf(normalized_dist) < 1.0f) {
        // Raised cosine for smooth wave profile
        constexpr float pi = 3.14159265f;
        brightness = 0.5f * (1.0f + cosf(normalized_dist * pi));
        // Squared for more defined center
        brightness = brightness * brightness;
      }

      // Apply brightness to color
      result[led_index] =
          LedColor{static_cast<uint8_t>(color.r * brightness),
                   static_cast<uint8_t>(color.g * brightness),
                   static_cast<uint8_t>(color.b * brightness),
                   static_cast<uint8_t>(color.w * brightness),
                   false};
    }

    return result;
  };
}

}  // namespace oww::ui::leds
