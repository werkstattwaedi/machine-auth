// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <atomic>
#include <optional>

#include "maco_firmware/modules/app_state/session_fsm.h"
#include "maco_firmware/modules/app_state/system_state.h"
#include "maco_firmware/modules/app_state/tag_verifier_observer.h"
#include "maco_firmware/modules/led_animator/led_animator.h"
#include "pw_allocator/allocator.h"
#include "pw_async2/coro.h"
#include "pw_async2/coro_or_else_task.h"
#include "pw_async2/dispatcher.h"
#include "pw_async2/time_provider.h"
#include "pw_chrono/system_clock.h"

namespace maco::terminal_led_effects {

/// Drives ambient LED ring effects based on session and tag verification state.
///
/// Lifecycle:
///   - Start() begins the boot animation immediately.
///   - The coroutine polls SystemState until boot_state == kReady, then
///     transitions to the idle effect and enters normal operation.
///
/// Normal operation effects:
///   - Idle (no session): gentle white breathing
///   - Active session: breathing green ring with two sweep arcs
///   - Tag NTAG-verified (awaiting cloud result): warm amber upward sweep
///   - Unauthorized: ~2.5 red blinks over 1.5 s, then reverts to session effect
///   - Authorized / tag removed: reverts to session effect
///
/// Unknown tags and early verification stages (OnTagDetected, OnVerifying,
/// OnAuthorizing) produce no LED change — effects only start once NTAG424
/// auth succeeds.
class TerminalLedEffects : public app_state::SessionObserver,
                           public app_state::TagVerifierObserver {
 public:
  TerminalLedEffects(
      led_animator::LedAnimatorBase& led,
      app_state::SystemState& system_state,
      pw::async2::TimeProvider<pw::chrono::SystemClock>& time_provider,
      pw::allocator::Allocator& allocator
  );

  /// Start the boot animation and launch the background coroutine.
  /// The coroutine transitions to idle once SystemState reports kReady.
  void Start(pw::async2::Dispatcher& dispatcher);

  // SessionObserver
  void OnSessionStarted(const app_state::SessionInfo& session) override;
  void OnSessionEnded(
      const app_state::SessionInfo& session,
      const app_state::MachineUsage& usage
  ) override;

  // TagVerifierObserver
  // OnTagDetected / OnVerifying: deliberately not overridden — no effect yet.
  void OnTagVerified(pw::ConstByteSpan ntag_uid) override;
  void OnUnknownTag() override;  // No effect.
  void OnAuthorized(
      const maco::TagUid& tag_uid,
      const maco::FirebaseId& user_id,
      const pw::InlineString<64>& user_label,
      const maco::FirebaseId& auth_id
  ) override;
  void OnUnauthorized() override;
  void OnTagRemoved() override;

 private:
  enum class Command : uint8_t {
    kNone,
    kSessionStarted,
    kSessionEnded,
    kTagVerified,
    kAuthorized,    // Reverts to session effect
    kUnauthorized,  // Blinks red twice, then reverts to session effect
    kTagRemoved,    // Reverts to session effect
  };

  pw::async2::Coro<pw::Status> Run(pw::async2::CoroContext& cx);
  void ApplySessionEffect();

  led_animator::LedAnimatorBase& led_;
  app_state::SystemState& system_state_;
  pw::async2::TimeProvider<pw::chrono::SystemClock>& time_provider_;

  // Set directly from OnSessionStarted/OnSessionEnded so it is always
  // accurate even when the corresponding LED command is overwritten by a
  // rapid subsequent event (e.g. kSessionStarted clobbered by kTagVerified).
  std::atomic<bool> session_active_{false};

  std::atomic<Command> pending_command_{Command::kNone};

  pw::async2::CoroContext coro_cx_;
  std::optional<pw::async2::CoroOrElseTask> task_;
};

}  // namespace maco::terminal_led_effects
