// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#define PW_LOG_MODULE_NAME "LEDS"

#include "maco_firmware/modules/terminal_led_effects/terminal_led_effects.h"

#include "maco_firmware/modules/app_state/system_state.h"
#include "maco_firmware/modules/app_state/ui/snapshot.h"
#include "maco_firmware/modules/led_animator/ambient_effects.h"
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
  // Update the flag immediately so ApplySessionEffect() always sees the
  // current session state, even if the LED command is clobbered by a
  // subsequent event before the coroutine picks it up.
  session_active_.store(true, std::memory_order_relaxed);
  pending_command_.store(Command::kSessionStarted, std::memory_order_relaxed);
}

void TerminalLedEffects::OnSessionEnded(
    const app_state::SessionInfo&, const app_state::MachineUsage&
) {
  session_active_.store(false, std::memory_order_relaxed);
  pending_command_.store(Command::kSessionEnded, std::memory_order_relaxed);
}

void TerminalLedEffects::OnSessionUiStateChanged(
    app_state::SessionStateUi state
) {
  session_ui_state_.store(state, std::memory_order_relaxed);
}

// --- TagVerifierObserver ---

void TerminalLedEffects::OnTagVerified(pw::ConstByteSpan) {
  pending_command_.store(Command::kTagVerified, std::memory_order_relaxed);
}

void TerminalLedEffects::OnUnknownTag() {
  // Unknown tags do not trigger any LED feedback.
}

void TerminalLedEffects::OnAuthorized(
    const maco::TagUid&,
    const maco::FirebaseId&,
    const pw::InlineString<64>&,
    const maco::FirebaseId&
) {
  pending_command_.store(Command::kAuthorized, std::memory_order_relaxed);
}

void TerminalLedEffects::OnUnauthorized() {
  pending_command_.store(Command::kUnauthorized, std::memory_order_relaxed);
}

void TerminalLedEffects::OnTagRemoved() {
  pending_command_.store(Command::kTagRemoved, std::memory_order_relaxed);
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
  pending_command_.store(Command::kNone, std::memory_order_relaxed);
  ApplySessionEffect();

  bool pending_effect_active = false;
  app_state::SessionStateUi pending_effect_state =
      app_state::SessionStateUi::kNoSession;

  while (true) {
    auto cmd =
        pending_command_.exchange(Command::kNone, std::memory_order_relaxed);

    // Check if we should show a pending-state LED effect.
    auto ui_state = session_ui_state_.load(std::memory_order_relaxed);
    bool is_pending =
        (ui_state == app_state::SessionStateUi::kStopPending ||
         ui_state == app_state::SessionStateUi::kCheckoutPending ||
         ui_state == app_state::SessionStateUi::kTakeoverPending);

    if (is_pending) {
      // Enter or switch pending effect
      if (!pending_effect_active || pending_effect_state != ui_state) {
        pending_effect_active = true;
        pending_effect_state = ui_state;
        if (ui_state == app_state::SessionStateUi::kTakeoverPending) {
          led_.SetAmbientEffect(TakeoverPendingAmbientEffect());
        } else {
          led_.SetAmbientEffect(StopPendingAmbientEffect());
        }
      }
      // Skip ambient-changing commands while in a pending state
    } else {
      if (pending_effect_active) {
        // Left pending state — revert to session effect
        pending_effect_active = false;
        ApplySessionEffect();
      }

      // Process commands normally
      switch (cmd) {
        case Command::kSessionStarted:
        case Command::kSessionEnded:
          ApplySessionEffect();
          break;

        case Command::kTagVerified:
          led_.SetAmbientEffect(AuthorizingTagAmbientEffect());
          break;

        case Command::kUnauthorized:
          led_.SetAmbientEffect(AccessDeniedAmbientEffect());
          co_await time_provider_.WaitFor(1500ms);
          if (pending_command_.load(std::memory_order_relaxed) ==
              Command::kNone) {
            ApplySessionEffect();
          }
          break;

        case Command::kAuthorized:
        case Command::kTagRemoved:
          ApplySessionEffect();
          break;

        case Command::kNone:
          break;
      }
    }

    co_await time_provider_.WaitFor(50ms);
  }
  // Unreachable — loop runs until the task is destroyed.
  co_return pw::OkStatus();
}

}  // namespace maco::terminal_led_effects
