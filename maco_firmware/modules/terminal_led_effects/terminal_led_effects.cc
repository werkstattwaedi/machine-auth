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

  while (true) {
    auto cmd =
        pending_command_.exchange(Command::kNone, std::memory_order_relaxed);

    switch (cmd) {
      case Command::kSessionStarted:
      case Command::kSessionEnded:
        ApplySessionEffect();
        break;

      case Command::kTagVerified:
        // NTAG424 mutual auth succeeded, cloud query starting.
        // Light, warm yellow: reassuring but not conclusive.
        led_.SetAmbientEffect(AuthorizingTagAmbientEffect());
        break;

      case Command::kUnauthorized:
        // ~2.5 red blinks at 0.6 s period over 1.5 s, then revert.
        led_.SetAmbientEffect(AccessDeniedAmbientEffect());
        co_await time_provider_.WaitFor(1500ms);
        // Only revert here if no newer command arrived during the blink.
        // If a command is pending it will be picked up on the next iteration.
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

    co_await time_provider_.WaitFor(50ms);
  }
  // Unreachable — loop runs until the task is destroyed.
  co_return pw::OkStatus();
}

}  // namespace maco::terminal_led_effects
