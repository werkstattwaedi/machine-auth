// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <mutex>
#include <optional>

#include "maco_firmware/hardware.h"
#include "maco_firmware/modules/led/led_driver.h"
#include "maco_firmware/modules/led/led_frame_renderer.h"
#include "maco_firmware/modules/led_animator/waveform.h"
#include "pw_sync/mutex.h"

namespace maco::led_animator {

// ---------------------------------------------------------------------------
// Physical LED layout (MACO terminal hardware)
// ---------------------------------------------------------------------------

// Ambient ring: 10 LEDs clockwise from bottom-left.
// ring_pos[i] = hardware LED index for ring position i.
//   Left side rises (0=LED5 at bottom-left → 4=LED9 at top-left gap)
//   Right side descends (5=LED12 at top-right gap → 9=LED0 at bottom-right)
static constexpr uint16_t kRingLeds[10] = {5, 6, 7, 8, 9, 12, 13, 14, 15, 0};

// Button LEDs: 0=top-left(10), 1=top-right(11), 2=btm-left(4), 3=btm-right(1)
static constexpr uint16_t kButtonLeds[4] = {10, 11, 4, 1};

// NFC LEDs (always driven identically): LED 3 and LED 2.
static constexpr uint16_t kNfcLeds[2] = {3, 2};

// ---------------------------------------------------------------------------
// Configuration types
// ---------------------------------------------------------------------------

/// A single moving hotspot on the ambient ring.
/// Each hotspot contributes linearly to adjacent ring positions (radius = 1.0).
struct HotspotConfig {
  Waveform waveform;
  float start_position = 0.0f;  // Initial ring position [0, 10)
  float velocity = 0.0f;        // Ring positions/second; positive = clockwise
  float phase_offset = 0.0f;    // Waveform phase at startup (0–1 of period)
};

/// Configuration for a single button LED.
struct ButtonConfig {
  Waveform waveform;
  float phase_offset = 0.0f;  // Waveform phase at startup (0–1 of period)
};

/// Groups all 10 hotspot configurations for the ambient ring.
struct AmbientEffect {
  HotspotConfig hotspots[10];
};

// ---------------------------------------------------------------------------
// LedAnimatorBase — non-template public interface
// ---------------------------------------------------------------------------

class LedAnimatorBase {
 public:
  virtual ~LedAnimatorBase() = default;

  /// Set the effect for a single button. Immediately interruptible.
  /// Thread-safe: may be called from any thread.
  virtual void SetButtonEffect(maco::Button button,
                               const ButtonConfig& config) = 0;

  /// Set the ambient ring effect (all 10 hotspot positions).
  /// Hotspots finish their current transition before starting a new one;
  /// only the latest queued update is kept. Thread-safe.
  virtual void SetAmbientEffect(const AmbientEffect& effect) = 0;

  /// Set the NFC LED effect (both LEDs driven identically).
  /// Immediately interruptible. Thread-safe.
  virtual void SetNfcEffect(const Waveform& waveform) = 0;
};

// ---------------------------------------------------------------------------
// LedAnimator<Driver> — concrete animation engine
// ---------------------------------------------------------------------------

/// LED animation engine. Registered as a LedFrameRenderer on Led<Driver>.
/// @tparam Driver  Concrete LED driver type (CRTP-based LedDriver).
template <typename Driver>
class LedAnimator : public LedAnimatorBase, public maco::led::LedFrameRenderer {
 public:
  static constexpr int kNumRing = 10;
  static constexpr int kNumButtons = 4;
  static constexpr int kNumHotspots = 10;
  static constexpr float kTransitionDuration = 0.4f;

  explicit LedAnimator(Driver& driver) : driver_(driver) {}

  // LedAnimatorBase

  void SetButtonEffect(maco::Button button,
                       const ButtonConfig& config) override {
    std::lock_guard<pw::sync::Mutex> lock(mutex_);
    StartButtonTransition(static_cast<int>(button), config);
  }

  void SetAmbientEffect(const AmbientEffect& effect) override {
    std::lock_guard<pw::sync::Mutex> lock(mutex_);
    if (hotspot_transition_.has_value()) {
      // Queue: finish current transition first, keep only the latest.
      PendingHotspots pending;
      for (int h = 0; h < kNumHotspots; ++h) {
        pending.hotspots[h] = effect.hotspots[h];
      }
      hotspot_pending_ = pending;
    } else {
      StartHotspotTransition(effect.hotspots);
    }
  }

  void SetNfcEffect(const Waveform& waveform) override {
    std::lock_guard<pw::sync::Mutex> lock(mutex_);
    StartNfcTransition(waveform);
  }

  // LedFrameRenderer — called once per frame from the Led render thread.
  void OnFrame(float dt_s) override {
    std::lock_guard<pw::sync::Mutex> lock(mutex_);
    RenderButtons(dt_s);
    RenderNfc(dt_s);
    RenderAmbient(dt_s);
  }

 private:
  // -------------------------------------------------------------------------
  // Internal state types
  // -------------------------------------------------------------------------

  struct HotspotState {
    float position = 0.0f;   // Current ring position [0, 10)
    float elapsed_s = 0.0f;  // Accumulated waveform time (seconds)
  };

  // Per-zone transition for buttons and NFC: crossfade from a static
  // color snapshot to a new waveform.
  struct ZoneTransition {
    maco::led::RgbwColor from_color;  // Blended output at transition start
    Waveform target_waveform;
    float target_elapsed_s = 0.0f;   // Elapsed time in target waveform
    float progress = 0.0f;           // 0 → 1
    float duration_s = kTransitionDuration;
  };

  // Hotspot transition: old and new hotspot states advance in parallel;
  // rendered ring outputs are lerp'd by progress.
  struct HotspotTransition {
    HotspotConfig from_configs[kNumHotspots];
    HotspotState from_states[kNumHotspots];
    HotspotConfig target_configs[kNumHotspots];
    HotspotState target_states[kNumHotspots];
    float progress = 0.0f;
    float duration_s = kTransitionDuration;
  };

  struct PendingHotspots {
    HotspotConfig hotspots[kNumHotspots];
  };

  // -------------------------------------------------------------------------
  // Button rendering
  // -------------------------------------------------------------------------

  void StartButtonTransition(int i, const ButtonConfig& target) {
    maco::led::RgbwColor from_color = EvalButtonColor(i);
    button_transitions_[i] = ZoneTransition{
        .from_color = from_color,
        .target_waveform = target.waveform,
        .target_elapsed_s =
            target.phase_offset * SafePeriod(target.waveform.period_s),
        .progress = 0.0f,
        .duration_s = kTransitionDuration,
    };
    current_buttons_[i] = target;
  }

  maco::led::RgbwColor EvalButtonColor(int i) const {
    if (button_transitions_[i].has_value()) {
      const auto& t = button_transitions_[i].value();
      maco::led::RgbwColor target_c =
          EvalWaveform(t.target_waveform, t.target_elapsed_s);
      return LerpColor(t.from_color, target_c, Smoothstep(t.progress));
    }
    return EvalWaveform(current_buttons_[i].waveform, button_elapsed_[i]);
  }

  void RenderButtons(float dt_s) {
    for (int i = 0; i < kNumButtons; ++i) {
      maco::led::RgbwColor color;
      if (button_transitions_[i].has_value()) {
        auto& t = button_transitions_[i].value();
        t.target_elapsed_s += dt_s;
        t.progress += dt_s / t.duration_s;
        if (t.progress >= 1.0f) {
          button_elapsed_[i] = t.target_elapsed_s;
          button_transitions_[i].reset();
          color =
              EvalWaveform(current_buttons_[i].waveform, button_elapsed_[i]);
        } else {
          maco::led::RgbwColor target_c =
              EvalWaveform(t.target_waveform, t.target_elapsed_s);
          color = LerpColor(t.from_color, target_c, Smoothstep(t.progress));
        }
      } else {
        button_elapsed_[i] += dt_s;
        color = EvalWaveform(current_buttons_[i].waveform, button_elapsed_[i]);
      }
      driver_.SetPixel(kButtonLeds[i], color);
    }
  }

  // -------------------------------------------------------------------------
  // NFC rendering
  // -------------------------------------------------------------------------

  void StartNfcTransition(const Waveform& target) {
    maco::led::RgbwColor from_color = EvalNfcColor();
    nfc_transition_ = ZoneTransition{
        .from_color = from_color,
        .target_waveform = target,
        .target_elapsed_s = 0.0f,
        .progress = 0.0f,
        .duration_s = kTransitionDuration,
    };
    current_nfc_ = target;
  }

  maco::led::RgbwColor EvalNfcColor() const {
    if (nfc_transition_.has_value()) {
      const auto& t = nfc_transition_.value();
      maco::led::RgbwColor target_c =
          EvalWaveform(t.target_waveform, t.target_elapsed_s);
      return LerpColor(t.from_color, target_c, Smoothstep(t.progress));
    }
    return EvalWaveform(current_nfc_, nfc_elapsed_);
  }

  void RenderNfc(float dt_s) {
    maco::led::RgbwColor color;
    if (nfc_transition_.has_value()) {
      auto& t = nfc_transition_.value();
      t.target_elapsed_s += dt_s;
      t.progress += dt_s / t.duration_s;
      if (t.progress >= 1.0f) {
        nfc_elapsed_ = t.target_elapsed_s;
        nfc_transition_.reset();
        color = EvalWaveform(current_nfc_, nfc_elapsed_);
      } else {
        maco::led::RgbwColor target_c =
            EvalWaveform(t.target_waveform, t.target_elapsed_s);
        color = LerpColor(t.from_color, target_c, Smoothstep(t.progress));
      }
    } else {
      nfc_elapsed_ += dt_s;
      color = EvalWaveform(current_nfc_, nfc_elapsed_);
    }
    for (uint16_t led : kNfcLeds) {
      driver_.SetPixel(led, color);
    }
  }

  // -------------------------------------------------------------------------
  // Ambient ring (hotspot) rendering
  // -------------------------------------------------------------------------

  void StartHotspotTransition(const HotspotConfig (&new_hotspots)[kNumHotspots]) {
    HotspotTransition transition;
    for (int h = 0; h < kNumHotspots; ++h) {
      transition.from_configs[h] = current_hotspots_[h];
      transition.from_states[h] = hotspot_states_[h];
      transition.target_configs[h] = new_hotspots[h];
      transition.target_states[h] = HotspotState{
          .position = new_hotspots[h].start_position,
          .elapsed_s = new_hotspots[h].phase_offset *
                       SafePeriod(new_hotspots[h].waveform.period_s),
      };
    }
    transition.progress = 0.0f;
    transition.duration_s = kTransitionDuration;
    hotspot_transition_ = transition;
    for (int h = 0; h < kNumHotspots; ++h) {
      current_hotspots_[h] = new_hotspots[h];
    }
  }

  void RenderAmbient(float dt_s) {
    maco::led::RgbwColor ring[kNumRing]{};

    if (hotspot_transition_.has_value()) {
      auto& t = hotspot_transition_.value();
      t.progress += dt_s / t.duration_s;

      AdvanceHotspotStates(t.from_configs, t.from_states, dt_s);
      AdvanceHotspotStates(t.target_configs, t.target_states, dt_s);

      maco::led::RgbwColor from_ring[kNumRing]{};
      maco::led::RgbwColor to_ring[kNumRing]{};
      RenderHotspots(t.from_configs, t.from_states, from_ring);
      RenderHotspots(t.target_configs, t.target_states, to_ring);

      float blend = Smoothstep(std::min(t.progress, 1.0f));
      for (int i = 0; i < kNumRing; ++i) {
        ring[i] = LerpColor(from_ring[i], to_ring[i], blend);
      }

      if (t.progress >= 1.0f) {
        for (int h = 0; h < kNumHotspots; ++h) {
          hotspot_states_[h] = t.target_states[h];
        }
        hotspot_transition_.reset();
        if (hotspot_pending_.has_value()) {
          PendingHotspots pending = hotspot_pending_.value();
          hotspot_pending_.reset();
          StartHotspotTransition(pending.hotspots);
        }
      }
    } else {
      AdvanceHotspotStates(current_hotspots_, hotspot_states_, dt_s);
      RenderHotspots(current_hotspots_, hotspot_states_, ring);
    }

    for (int i = 0; i < kNumRing; ++i) {
      driver_.SetPixel(kRingLeds[i], ring[i]);
    }
  }

  // -------------------------------------------------------------------------
  // Static helpers
  // -------------------------------------------------------------------------

  static void AdvanceHotspotStates(const HotspotConfig* configs,
                                   HotspotState* states,
                                   float dt_s) {
    for (int h = 0; h < kNumHotspots; ++h) {
      states[h].elapsed_s += dt_s;
      states[h].position += configs[h].velocity * dt_s;
      // Wrap to [0, 10)
      while (states[h].position >= 10.0f) states[h].position -= 10.0f;
      while (states[h].position < 0.0f) states[h].position += 10.0f;
    }
  }

  static void RenderHotspots(const HotspotConfig* configs,
                              const HotspotState* states,
                              maco::led::RgbwColor ring[kNumRing]) {
    for (int h = 0; h < kNumHotspots; ++h) {
      float t_norm = std::fmod(states[h].elapsed_s,
                               SafePeriod(configs[h].waveform.period_s)) /
                     SafePeriod(configs[h].waveform.period_s);
      maco::led::RgbwColor hcolor = configs[h].waveform.Evaluate(t_norm);
      if (hcolor.r == 0 && hcolor.g == 0 && hcolor.b == 0 && hcolor.w == 0) {
        continue;  // Skip dark hotspots (no contribution)
      }
      for (int i = 0; i < kNumRing; ++i) {
        float diff = states[h].position - static_cast<float>(i);
        // Wrap distance to (-5, 5] for a 10-position ring
        if (diff > 5.0f) diff -= 10.0f;
        else if (diff <= -5.0f) diff += 10.0f;
        float contribution = std::max(0.0f, 1.0f - std::abs(diff));
        if (contribution <= 0.0f) continue;
        ring[i].r = ClampAdd(ring[i].r, hcolor.r, contribution);
        ring[i].g = ClampAdd(ring[i].g, hcolor.g, contribution);
        ring[i].b = ClampAdd(ring[i].b, hcolor.b, contribution);
        ring[i].w = ClampAdd(ring[i].w, hcolor.w, contribution);
      }
    }
  }

  static maco::led::RgbwColor EvalWaveform(const Waveform& w, float elapsed_s) {
    float t = std::fmod(elapsed_s, SafePeriod(w.period_s)) /
              SafePeriod(w.period_s);
    return w.Evaluate(t);
  }

  static maco::led::RgbwColor LerpColor(maco::led::RgbwColor a,
                                        maco::led::RgbwColor b,
                                        float t) {
    return {
        static_cast<uint8_t>(static_cast<int>(a.r) +
                             static_cast<int>(t * (b.r - a.r))),
        static_cast<uint8_t>(static_cast<int>(a.g) +
                             static_cast<int>(t * (b.g - a.g))),
        static_cast<uint8_t>(static_cast<int>(a.b) +
                             static_cast<int>(t * (b.b - a.b))),
        static_cast<uint8_t>(static_cast<int>(a.w) +
                             static_cast<int>(t * (b.w - a.w))),
    };
  }

  static float Smoothstep(float t) {
    t = std::max(0.0f, std::min(1.0f, t));
    return t * t * (3.0f - 2.0f * t);
  }

  static uint8_t ClampAdd(uint8_t base, uint8_t add, float factor) {
    int result = static_cast<int>(base) + static_cast<int>(add * factor);
    return static_cast<uint8_t>(std::min(result, 255));
  }

  // Guard against divide-by-zero or nonsensical periods.
  static float SafePeriod(float period_s) {
    return period_s > 0.0001f ? period_s : 1.0f;
  }

  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------

  Driver& driver_;
  pw::sync::Mutex mutex_;

  // Button zone state
  ButtonConfig current_buttons_[kNumButtons]{};
  float button_elapsed_[kNumButtons]{};
  std::optional<ZoneTransition> button_transitions_[kNumButtons];

  // NFC zone state
  Waveform current_nfc_{};
  float nfc_elapsed_ = 0.0f;
  std::optional<ZoneTransition> nfc_transition_;

  // Hotspot (ambient ring) state
  HotspotConfig current_hotspots_[kNumHotspots]{};
  HotspotState hotspot_states_[kNumHotspots]{};
  std::optional<HotspotTransition> hotspot_transition_;
  std::optional<PendingHotspots> hotspot_pending_;
};

}  // namespace maco::led_animator
