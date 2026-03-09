// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#define PW_LOG_MODULE_NAME "LEDS"

#include "maco_firmware/modules/terminal_led_effects/terminal_led_effects.h"

#include "maco_firmware/modules/app_state/system_state.h"
#include "maco_firmware/modules/app_state/ui/snapshot.h"
#include "maco_firmware/modules/led_animator/ambient_effects.h"
#include "maco_firmware/modules/led_animator/nfc_effects.h"
#include "pw_log/log.h"

namespace maco::terminal_led_effects {

using namespace std::chrono_literals;
using namespace maco::led_animator;

inline AmbientEffect BootAmbientEffect() {
  return led_animator::UpwardAmbient(maco::led::RgbwColor{0, 0, 0, 255}, 4.0f);
}

inline AmbientEffect IdleAmbientEffect() {
  return led_animator::BreathingAmbient(
      maco::led::RgbwColor{0, 0, 0, 192}, 5.0f, 0.3f
  );
}

inline AmbientEffect AuthorizingTagAmbientEffect() {
  return led_animator::UpwardAmbient(
      maco::led::RgbwColor{160, 120, 0, 0}, 4.0f
  );
}

inline AmbientEffect SessionActiveAmbientEffect() {
  auto active_color = maco::led::RgbwColor{0, 180, 0, 0};

  AmbientEffect effect;
  effect.hotspots[0] = HotspotConfig{
      .waveform =
          {
              .shape = Waveform::Shape::kBreathing,
              .color = active_color,
              .period_s = 5.0f,
              .min_brightness = .3f,
          },
      .start_position = kPi,  // anchor at bottom-left
      .velocity = 0,
      .radius = kPi * 2,
      .falloff_shape = 0,
  };

  effect.hotspots[1] = HotspotConfig{
      .waveform =
          Waveform{.shape = Waveform::Shape::kFixed, .color = active_color},
      .start_position = kPi,  // anchor at bottom
      .velocity = 1,
      .phase_offset = 0,
      .radius = kPi / 2.5f,
      .falloff_shape = 3.0f,
      .sweep_arc = 2 * kPi * 0.95,
      .return_multiplier = 10.0f
  };

  effect.hotspots[2] = HotspotConfig{
      .waveform =
          Waveform{.shape = Waveform::Shape::kFixed, .color = active_color},
      .start_position = kPi,  // anchor at bottom
      .velocity = 1,
      .phase_offset = 0.5f,
      .radius = kPi / 2.5f,
      .falloff_shape = 3.0f,
      .sweep_arc = 2 * kPi * 0.95,
      .return_multiplier = 10.0f
  };

  return effect;
}

inline AmbientEffect AccessDeniedAmbientEffect() {
  return led_animator::BlinkAmbient(
      maco::led::RgbwColor{255, 0, 0, 0}, 0.6f, 0.2f
  );
}

// Green drains to white from top to bottom during stop/checkout countdown.
inline AmbientEffect StopPendingAmbientEffect() {
  auto white = maco::led::RgbwColor{0, 0, 0, 200};
  auto active_color = maco::led::RgbwColor{0, 180, 0, 0};

  AmbientEffect effect;
  effect.hotspots[0] = HotspotConfig{
      .waveform =
          {
              .shape = Waveform::Shape::kBreathing,
              .color = active_color,
              .period_s = 5.0f,
              .min_brightness = .3f,
          },
      .start_position = kPi,  // anchor at bottom-left
      .velocity = 0,
      .radius = kPi * 2,
      .falloff_shape = 0,
  };

  // White sweep down the right side (CW from top to bottom)
  effect.hotspots[1] = HotspotConfig{
      .waveform = Waveform{.shape = Waveform::Shape::kFixed, .color = white},
      .start_position = 0,  // top
      .velocity = 1.1f,     // π/1.1 ≈ 2.85s forward
      .radius = kPi / 2,
      .falloff_shape = 2.0f,
      .sweep_arc = kPi,  // CW half: top → bottom
      .return_multiplier = 1.0f,
      .sweep_phase_offset = 0.8f,  // start in return phase → fade in
  };

  // White sweep down the left side (CCW from top to bottom)
  effect.hotspots[2] = HotspotConfig{
      .waveform = Waveform{.shape = Waveform::Shape::kFixed, .color = white},
      .start_position = 0,  // top
      .velocity = -1.1f,
      .radius = kPi / 2,
      .falloff_shape = 2.0f,
      .sweep_arc = -kPi,  // CCW half: top → bottom
      .return_multiplier = 1.0f,
      .sweep_phase_offset = 0.8f,  // start in return phase → fade in
  };

  return effect;
}

// Takeover: white base with green rising from bottom, pushing white up.
inline AmbientEffect TakeoverPendingAmbientEffect() {
  auto green = maco::led::RgbwColor{0, 180, 0, 0};
  auto white = maco::led::RgbwColor{0, 0, 0, 160};

  AmbientEffect effect;
  // White base (neutral, incoming user)
  effect.hotspots[0] = HotspotConfig{
      .waveform = Waveform{.shape = Waveform::Shape::kFixed, .color = white},
      .start_position = kPi,
      .velocity = 0,
      .radius = kPi * 2,
      .falloff_shape = 0,
  };

  // Green sweep up the left side (CW from bottom to top)
  effect.hotspots[1] = HotspotConfig{
      .waveform = Waveform{.shape = Waveform::Shape::kFixed, .color = green},
      .start_position = kPi,  // bottom
      .velocity = 1.1f,
      .radius = kPi / 2.5f,
      .falloff_shape = 2.0f,
      .sweep_arc = kPi,  // CW: bottom → top (left side)
      .return_multiplier = 0.05f,
  };

  // Green sweep up the right side (CCW from bottom to top)
  effect.hotspots[2] = HotspotConfig{
      .waveform = Waveform{.shape = Waveform::Shape::kFixed, .color = green},
      .start_position = kPi,  // bottom
      .velocity = 1.1f,
      .radius = kPi / 2.5f,
      .falloff_shape = 2.0f,
      .sweep_arc = -kPi,  // CCW: bottom → top (right side)
      .return_multiplier = 0.05f,
  };

  return effect;
}

TerminalLedEffects::TerminalLedEffects(
    led_animator::LedAnimatorBase& led,
    app_state::SystemState& system_state,
    pw::async2::TimeProvider<pw::chrono::SystemClock>& time_provider,
    pw::allocator::Allocator& allocator
)
    : led_(led),
      system_state_(system_state),
      time_provider_(time_provider),
      coro_cx_(allocator) {}

void TerminalLedEffects::Start(pw::async2::Dispatcher& dispatcher) {
  led_.SetAmbientEffect(BootAmbientEffect());

  auto coro = Run(coro_cx_);
  task_.emplace(std::move(coro), [](pw::Status s) {
    PW_LOG_ERROR("TerminalLedEffects failed: %d", static_cast<int>(s.code()));
  });
  dispatcher.Post(*task_);
}

// --- SessionObserver ---

void TerminalLedEffects::OnSessionStarted(const app_state::SessionInfo&) {
  session_active_.store(true, std::memory_order_relaxed);
  pending_session_cmd_.store(
      SessionCommand::kSessionStarted, std::memory_order_relaxed);
}

void TerminalLedEffects::OnSessionEnded(
    const app_state::SessionInfo&, const app_state::MachineUsage&
) {
  session_active_.store(false, std::memory_order_relaxed);
  pending_session_cmd_.store(
      SessionCommand::kSessionEnded, std::memory_order_relaxed);
}

void TerminalLedEffects::OnSessionUiStateChanged(
    app_state::SessionStateUi state
) {
  session_ui_state_.store(state, std::memory_order_relaxed);
}

// --- TagVerifierObserver ---

void TerminalLedEffects::OnTagDetected(pw::ConstByteSpan) {
  pending_tag_cmd_.store(TagCommand::kTagDetected, std::memory_order_relaxed);
}

void TerminalLedEffects::OnTagVerified(pw::ConstByteSpan) {
  pending_tag_cmd_.store(TagCommand::kTagVerified, std::memory_order_relaxed);
}

void TerminalLedEffects::OnUnknownTag() {
  pending_tag_cmd_.store(TagCommand::kUnknownTag, std::memory_order_relaxed);
}

void TerminalLedEffects::OnAuthorized(
    const maco::TagUid&,
    const maco::FirebaseId&,
    const pw::InlineString<64>&,
    const maco::FirebaseId&
) {
  pending_tag_cmd_.store(TagCommand::kAuthorized, std::memory_order_relaxed);
}

void TerminalLedEffects::OnUnauthorized() {
  pending_tag_cmd_.store(TagCommand::kUnauthorized, std::memory_order_relaxed);
}

void TerminalLedEffects::OnTagRemoved() {
  pending_tag_cmd_.store(TagCommand::kTagRemoved, std::memory_order_relaxed);
}

// --- Internal ---

void TerminalLedEffects::ApplySessionEffect() {
  if (session_active_.load(std::memory_order_relaxed)) {
    // Breathing green ring with two sweep arcs offset by half a period.
    led_.SetAmbientEffect(SessionActiveAmbientEffect());
  } else {
    // Idle breathing: slow warm-white pulse.
    led_.SetAmbientEffect(IdleAmbientEffect());
  }
}

pw::async2::Coro<pw::Status> TerminalLedEffects::Run(
    [[maybe_unused]] pw::async2::CoroContext& cx
) {
  // Boot phase: keep the boot animation until SystemState reports kReady.
  {
    app_state::SystemStateSnapshot snapshot;
    system_state_.GetSnapshot(snapshot);
    while (snapshot.boot_state != app_state::BootState::kReady) {
      co_await time_provider_.WaitFor(50ms);
      system_state_.GetSnapshot(snapshot);
    }
  }

  // Discard any events that arrived while booting (e.g. early NFC reads).
  pending_tag_cmd_.store(TagCommand::kNone, std::memory_order_relaxed);
  pending_session_cmd_.store(SessionCommand::kNone, std::memory_order_relaxed);
  ApplySessionEffect();

  // NFC area ready: solid white.
  auto nfc_white = maco::led::RgbwColor{0, 0, 0, 80};
  auto nfc_denied = maco::led::RgbwColor{120, 0, 0, 80};
  led_.SetNfcEffect(SolidNfc(nfc_white));

  bool pending_effect_active = false;
  app_state::SessionStateUi pending_effect_state =
      app_state::SessionStateUi::kNoSession;

  while (true) {
    auto tag_cmd =
        pending_tag_cmd_.exchange(TagCommand::kNone, std::memory_order_relaxed);
    auto session_cmd = pending_session_cmd_.exchange(
        SessionCommand::kNone, std::memory_order_relaxed);

    // --- NFC LEDs: always process tag commands (independent of pending state)
    switch (tag_cmd) {
      case TagCommand::kTagDetected:
        led_.SetNfcEffect(
            BreathingNfc(maco::led::RgbwColor{0, 0, 0, 160}, 0.8f, 0.6f));
        break;

      case TagCommand::kUnknownTag:
        led_.SetNfcEffect(BreathingNfc(nfc_denied, 0.8f, 0.6f));
        break;

      case TagCommand::kTagVerified:
        led_.SetNfcEffect(
            BreathingNfc(maco::led::RgbwColor{200, 160, 0, 0}, 0.8f, 0.6f));
        break;

      case TagCommand::kAuthorized:
        led_.SetNfcEffect(
            BreathingNfc(maco::led::RgbwColor{0, 200, 0, 0}, 0.8f, 0.6f));
        break;

      case TagCommand::kUnauthorized:
        led_.SetNfcEffect(BreathingNfc(nfc_denied, 0.8f, 0.6f));
        break;

      case TagCommand::kTagRemoved:
        led_.SetNfcEffect(SolidNfc(nfc_white));
        break;

      case TagCommand::kNone:
        break;
    }

    // --- Ambient ring: check pending UI state first
    auto ui_state = session_ui_state_.load(std::memory_order_relaxed);
    bool is_pending =
        (ui_state == app_state::SessionStateUi::kStopPending ||
         ui_state == app_state::SessionStateUi::kCheckoutPending ||
         ui_state == app_state::SessionStateUi::kTakeoverPending);

    if (is_pending) {
      if (!pending_effect_active || pending_effect_state != ui_state) {
        pending_effect_active = true;
        pending_effect_state = ui_state;
        if (ui_state == app_state::SessionStateUi::kTakeoverPending) {
          led_.SetAmbientEffect(TakeoverPendingAmbientEffect());
        } else {
          led_.SetAmbientEffect(StopPendingAmbientEffect());
        }
      }
    } else {
      if (pending_effect_active) {
        pending_effect_active = false;
        ApplySessionEffect();
      }

      // Process ambient effects from tag events.
      bool tag_handled_ambient = false;
      switch (tag_cmd) {
        case TagCommand::kTagVerified:
          led_.SetAmbientEffect(AuthorizingTagAmbientEffect());
          tag_handled_ambient = true;
          break;

        case TagCommand::kAuthorized:
        case TagCommand::kTagRemoved:
          ApplySessionEffect();
          tag_handled_ambient = true;
          break;

        case TagCommand::kUnauthorized:
          led_.SetAmbientEffect(AccessDeniedAmbientEffect());
          tag_handled_ambient = true;
          co_await time_provider_.WaitFor(1500ms);
          if (pending_tag_cmd_.load(std::memory_order_relaxed) ==
              TagCommand::kNone) {
            ApplySessionEffect();
            led_.SetNfcEffect(SolidNfc(nfc_white));
          }
          break;

        default:
          break;
      }

      // Process session events when no tag event already touched ambient.
      if (!tag_handled_ambient) {
        switch (session_cmd) {
          case SessionCommand::kSessionStarted:
          case SessionCommand::kSessionEnded:
            ApplySessionEffect();
            break;
          case SessionCommand::kNone:
            break;
        }
      }
    }

    co_await time_provider_.WaitFor(50ms);
  }
  // Unreachable — loop runs until the task is destroyed.
  co_return pw::OkStatus();
}

}  // namespace maco::terminal_led_effects
