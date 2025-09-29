#include "led_controller.h"

namespace oww::ui::leds {

static uint8_t breathe_brightness(uint32_t now, uint16_t period_ms,
                                  uint8_t min_b, uint8_t max_b) {
  if (max_b < min_b) std::swap(max_b, min_b);
  const float t = (now % period_ms) / static_cast<float>(period_ms);
  constexpr float pi = 3.14159265f;
  const float s = 0.5f * (1.0f - cosf(t * 2.0f * pi));  // 0..1 ease
  const float v = min_b + (max_b - min_b) * s;
  return static_cast<uint8_t>(v);
}

void Section::Render(uint32_t now_ms) {
  switch (effect_.type) {
    case EffectType::Off:
      for (auto i : indices_) owner_->Paint(i, Color::Off());
      break;
    case EffectType::Solid:
      for (auto i : indices_) owner_->Paint(i, effect_.color, 255);
      break;
    case EffectType::Breathe: {
      uint8_t br =
          breathe_brightness(now_ms, effect_.period_ms, effect_.min_brightness,
                             effect_.max_brightness);
      for (auto i : indices_) owner_->Paint(i, effect_.color, br);
      break;
    }
    case EffectType::Blink: {
      uint8_t phase = static_cast<uint8_t>((now_ms % effect_.period_ms) * 255 /
                                           effect_.period_ms);
      bool on = phase < effect_.duty_cycle;
      for (auto i : indices_) owner_->Paint(i, effect_.color, on ? 255 : 0);
      break;
    }
    case EffectType::Rotate: {
      // Base class: treat as solid
      for (auto i : indices_) owner_->Paint(i, effect_.color, 255);
      break;
    }
  }
}

void ButtonSection::Render(uint32_t now_ms) {
  // Determine brightness modulation from effect_
  uint8_t br = 255;
  switch (effect_.type) {
    case EffectType::Off:
      br = 0;
      break;
    case EffectType::Solid:
      br = 255;
      break;
    case EffectType::Breathe:
      br = breathe_brightness(now_ms, effect_.period_ms, effect_.min_brightness,
                              effect_.max_brightness);
      break;
    case EffectType::Blink: {
      uint8_t phase = static_cast<uint8_t>((now_ms % effect_.period_ms) * 255 /
                                           effect_.period_ms);
      br = (phase < effect_.duty_cycle) ? 255 : 0;
      break;
    }
    case EffectType::Rotate:
      br = 255;  // not meaningful for buttons
      break;
  }

  // Map: [tl,tr,bl,br] to indices in order stored
  const Color colors[4] = {colors_.top_left, colors_.top_right,
                           colors_.bottom_left, colors_.bottom_right};
  for (size_t k = 0; k < indices_.size() && k < 4; ++k) {
    owner_->Paint(indices_[k], colors[k], br);
  }
}

void LedController::InitializeDefaultMapping() {
  // Index map based on the product sketch numbering (0..15):
  // Perimeter ring (clockwise starting at bottom-right):
  // 0, 15, 14, 13, 12, 9, 8, 7, 6, 5
  ring_ = RingSection(this, {0, 15, 14, 13, 12, 9, 8, 7, 6, 5});

  // Buttons backlight [top-left, top-right, bottom-left, bottom-right]
  // -> indices: 10, 11, 4, 1
  buttons_ = ButtonSection(this, {10, 11, 4, 1});

  // NFC area backlight: two center-bottom tiles -> indices 2 and 3
  nfc_ = NfcSection(this, {2, 3});

  // Default physical distances (rough, in arbitrary units). Order matches
  // ring indices above: [0,15,14,13,12,9,8,7,6,5]
  // Bottom-right -> right side -> top -> left side -> bottom-left
  // Edges: right side ~3 units per gap, top tight ~1 unit, left side ~3 units,
  // bottom single step to close loop ~3 units.
  std::vector<float> default_edges = {3.0f, 3.0f, 3.0f, 1.0f, 1.0f,
                                      3.0f, 3.0f, 3.0f, 3.0f, 3.0f};
  SetRingEdgeLengths(default_edges);
}

void LedController::Tick(uint32_t now_ms) {
  // Render each section
  ring_.Render(now_ms);

  // Ring rotate specialization
  if (ring_.GetEffect().type == EffectType::Rotate &&
      !ring_.Indices().empty()) {
    const auto& cfg = ring_.GetEffect();
    const size_t n = ring_.Indices().size();
    const uint32_t period = std::max<uint16_t>(cfg.period_ms, 1);

    // Use physical positions (if available) for smooth rotation
    // Compute a moving phase over total perimeter
    const float total_len = (ring_pos_.size() == n)
                                ? (ring_pos_.back() + ring_wrap_len_)
                                : (float)n;
    const float t = (now_ms % period) / (float)period;  // 0..1
    const float base = (cfg.direction >= 0 ? t : (1.0f - t)) * total_len;

    // Lobe width in same units; interpret lit_pixels as tenths of a nominal
    // pixel span around the perimeter for fine control.
    // Baseline: 10 => approx one nominal pixel; 5 => half; 20 => double.
    const float nominal_span = total_len / std::max<size_t>(n, 1);
    const float lobe = std::max(0.02f, (cfg.lit_pixels / 10.0f) * nominal_span);
    constexpr float pi = 3.14159265f;

    for (size_t i = 0; i < n; ++i) {
      float pos = (ring_pos_.size() == n) ? ring_pos_[i] : (float)i;
      // Distance to nearest of K evenly spaced hotspots
      float d = 1e9f;
      const uint8_t K = std::max<uint8_t>(1, cfg.hotspots);
      const float step = total_len / K;
      for (uint8_t k = 0; k < K; ++k) {
        float center = base + k * step;
        // wrap centers into [0,total_len)
        while (center >= total_len) center -= total_len;
        while (center < 0.0f) center += total_len;
        float dk = fabsf(pos - center);
        dk = std::min(dk, total_len - dk);
        d = std::min(d, dk);
      }
      // Cosine lobe: full at center, fades to 0 at distance=lobe
      float x = std::max(0.0f, 1.0f - (d / lobe));
      float brf = 0.5f * (1.0f + cosf((1.0f - x) * pi));  // smooth peak
      uint8_t br = static_cast<uint8_t>(255.0f * brf);
      Paint(ring_.Indices()[i], cfg.color, br);
    }
  }

  buttons_.Render(now_ms);
  nfc_.Render(now_ms);

  // Push to strip
  strip_->show();
}

void LedController::SetRingEdgeLengths(const std::vector<float>& edge_lengths) {
  const auto& idx = ring_.Indices();
  const size_t n = idx.size();
  if (edge_lengths.size() != n) {
    // Fallback to uniform spacing
    ring_pos_.resize(n);
    for (size_t i = 0; i < n; ++i) ring_pos_[i] = (float)i;
    ring_wrap_len_ = 1.0f;  // uniform step
    return;
  }
  ring_pos_.resize(n);
  float acc = 0.0f;
  for (size_t i = 0; i < n; ++i) {
    ring_pos_[i] = acc;
    acc += std::max(0.001f, edge_lengths[i]);
  }
  // distance from last pixel back to first to complete the loop
  ring_wrap_len_ = std::max(0.001f, edge_lengths.back());
}

}  // namespace oww::ui::leds
