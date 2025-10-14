#include "ui/leds/led_effect.h"
#include <algorithm>

namespace oww::ui::leds {

LedColor BlendColors(const LedColor& a, const LedColor& b, float factor) {
  // Don't blend if either color is unspecified
  if (a.unspecified) return b;
  if (b.unspecified) return a;

  factor = std::clamp(factor, 0.0f, 1.0f);

  return LedColor{
      static_cast<uint8_t>(a.r + (b.r - a.r) * factor),
      static_cast<uint8_t>(a.g + (b.g - a.g) * factor),
      static_cast<uint8_t>(a.b + (b.b - a.b) * factor),
      static_cast<uint8_t>(a.w + (b.w - a.w) * factor),
      false};
}

}  // namespace oww::ui::leds
