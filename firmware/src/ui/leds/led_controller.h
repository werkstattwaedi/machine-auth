#pragma once

#include <algorithm>
#include <cmath>
#include <memory>
#include <vector>

#include "neopixel.h"

namespace oww::ui::leds {

// Compact color container for RGBW pixels
struct Color {
  uint8_t r{0}, g{0}, b{0}, w{0};
  static Color Off() { return {}; }
  static Color RGB(uint8_t r, uint8_t g, uint8_t b, uint8_t w = 0) {
    return Color{r, g, b, w};
  }
  static Color WarmWhite(uint8_t w) { return Color{0, 0, 0, w}; }
};

enum class EffectType : uint8_t { Off, Solid, Breathe, Blink, Rotate };

struct EffectConfig {
  EffectType type{EffectType::Off};
  Color color{Color::Off()};
  // Common
  uint16_t period_ms{2000};  // Breathe/Blink/Rotate base period
  // Breathe
  uint8_t min_brightness{8};   // 0..255 scaling
  uint8_t max_brightness{96};  // 0..255 scaling
  // Blink
  uint8_t duty_cycle{127};  // 0..255
  // Rotate
  // Lobe width control in tenths (fine control). For example 10 ~= baseline
  // width of one nominal pixel span, 5 ~= half, 20 ~= double.
  uint8_t lit_pixels{10};
  int8_t direction{1};  // +1 clockwise, -1 counter-clockwise
  uint8_t hotspots{1};  // number of evenly spaced hotspots around ring
};

// Helper to scale an RGBW color by 0..255 factor
inline Color scale(const Color& c, uint8_t s) {
  auto mul = [](uint8_t v, uint8_t s) -> uint8_t {
    return static_cast<uint8_t>((static_cast<uint16_t>(v) * s) / 255);
  };
  return Color{mul(c.r, s), mul(c.g, s), mul(c.b, s), mul(c.w, s)};
}

class LedController;

// Base class: a logical LED section controlling a subset of indices
class Section {
 public:
  Section(LedController* owner, std::vector<uint8_t> indices)
      : owner_(owner), indices_(std::move(indices)) {}
  virtual ~Section() = default;

  // Change the active effect
  virtual void SetEffect(const EffectConfig& cfg) { effect_ = cfg; }

  // Drive pixels for this section
  virtual void Render(uint32_t now_ms);

  const EffectConfig& GetEffect() const { return effect_; }
  const std::vector<uint8_t>& Indices() const { return indices_; }

 protected:
  LedController* owner_;
  std::vector<uint8_t> indices_;
  EffectConfig effect_{};
};

// Ring section: supports Rotate in addition to base effects
class RingSection : public Section {
 public:
  using Section::Section;
  void SetRotate(Color color, uint8_t lit_pixels = 1, uint16_t period_ms = 2000,
                 int8_t direction = 1) {
    EffectConfig cfg;
    cfg.type = EffectType::Rotate;
    cfg.color = color;
    cfg.lit_pixels = lit_pixels;
    cfg.period_ms = period_ms;
    cfg.direction = direction;
    Section::SetEffect(cfg);
  }
};

// Buttons section: allows four per-button colors but one common effect
struct ButtonColors {
  Color top_left{Color::Off()};
  Color top_right{Color::Off()};
  Color bottom_left{Color::Off()};
  Color bottom_right{Color::Off()};
};

class ButtonSection : public Section {
 public:
  ButtonSection(LedController* owner, const std::vector<uint8_t>& indices)
      : Section(owner, indices) {}

  void SetColors(const ButtonColors& c) { colors_ = c; }
  void Render(uint32_t now_ms) override;

 private:
  ButtonColors colors_{};
};

// NFC backlight section (two pixels)
class NfcSection : public Section {
 public:
  using Section::Section;
};

// Facade that owns all sections and updates the physical strip
class LedController {
 public:
  explicit LedController(Adafruit_NeoPixel* strip) : strip_(strip) {}

  RingSection& Ring() { return ring_; }
  ButtonSection& Buttons() { return buttons_; }
  NfcSection& Nfc() { return nfc_; }

  void InitializeDefaultMapping();
  // Optional: provide custom per-edge distances for ring (size must equal
  // ring indices count). Values are relative units; only ratios matter.
  void SetRingEdgeLengths(const std::vector<float>& edge_lengths);

  // Call this each frame to render all effects and push to the strip
  void Tick(uint32_t now_ms);

  // Low-level paint, used by sections
  void Paint(uint8_t pixel, const Color& c, uint8_t brightness = 255) {
    Color s = scale(c, brightness);
    strip_->setPixelColor(pixel, s.r, s.g, s.b, s.w);
  }

  size_t PixelCount() const { return strip_->numPixels(); }

 private:
  Adafruit_NeoPixel* strip_;
  // Sections are built with index mapping in InitializeDefaultMapping()
  RingSection ring_{this, {}};
  ButtonSection buttons_{this, {}};
  NfcSection nfc_{this, {}};

  // Physical model for ring animation
  std::vector<float> ring_pos_;  // cumulative positions per pixel
  float ring_wrap_len_{0.0f};    // length from last to first
};

}  // namespace oww::ui::leds
