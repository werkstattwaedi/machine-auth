// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <atomic>
#include <optional>

#include "maco_firmware/modules/app_state/session_fsm.h"
#include "maco_firmware/modules/app_state/system_state.h"
#include "maco_firmware/modules/app_state/tag_verifier_observer.h"
#include "maco_firmware/modules/buzzer/buzzer.h"
#include "maco_firmware/modules/led_animator/led_animator.h"
#include "pw_allocator/allocator.h"
#include "pw_async2/coro.h"
#include "pw_async2/coro_or_else_task.h"
#include "pw_async2/dispatcher.h"
#include "pw_async2/time_provider.h"
#include "pw_chrono/system_clock.h"

namespace maco::terminal_effects {

/// Drives ambient LED ring effects and buzzer feedback based on session and
/// tag verification state.
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
/// NFC area LEDs indicate tag verification progress:
///   - Ready (idle): solid white
///   - Tag detected: bright white pulse
///   - Unknown tag: red pulse
///   - Verified (genuine NTAG424): yellow pulse
///   - Authorized: green pulse
///   - Tag removed: back to solid white
///
/// Buzzer tones provide audible feedback:
///   - Tag detected: 1500 Hz, 100ms (medium acknowledgment)
///   - Unknown/unauthorized: 800 Hz, 200ms (low negative feedback)
///   - Authorized: 2500 Hz, 150ms (high success tone)
class TerminalEffects : public app_state::SessionObserver,
                        public app_state::TagVerifierObserver {
 public:
  TerminalEffects(
      led_animator::LedAnimatorBase& led,
      buzzer::Buzzer& buzzer,
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
  void OnSessionUiStateChanged(app_state::SessionStateUi state) override;

  // TagVerifierObserver
  void OnTagDetected(pw::ConstByteSpan uid) override;
  void OnTagVerified(pw::ConstByteSpan ntag_uid) override;
  void OnUnknownTag() override;
  void OnAuthorized(
      const maco::TagUid& tag_uid,
      const maco::FirebaseId& user_id,
      const pw::InlineString<64>& user_label,
      const maco::FirebaseId& auth_id
  ) override;
  void OnUnauthorized() override;
  void OnTagRemoved() override;

 private:
  // Tag events drive NFC LEDs + some ambient effects.
  enum class TagCommand : uint8_t {
    kNone,
    kTagDetected,
    kTagVerified,
    kUnknownTag,
    kAuthorized,
    kUnauthorized,
    kTagRemoved,
  };

  // Session events drive ambient ring effects only.
  enum class SessionCommand : uint8_t {
    kNone,
    kSessionStarted,
    kSessionEnded,
  };

  pw::async2::Coro<pw::Status> Run(pw::async2::CoroContext& cx);
  void ApplySessionEffect();

  led_animator::LedAnimatorBase& led_;
  buzzer::Buzzer& buzzer_;
  app_state::SystemState& system_state_;
  pw::async2::TimeProvider<pw::chrono::SystemClock>& time_provider_;

  // Set directly from OnSessionStarted/OnSessionEnded so it is always
  // accurate even when the corresponding LED command is overwritten by a
  // rapid subsequent event (e.g. kSessionStarted clobbered by kTagVerified).
  std::atomic<bool> session_active_{false};

  // Snapshot of session_active_ at tag-detect time, so OnAuthorized can tell
  // whether this tag tap is starting or ending a session.  Safe regardless of
  // observer registration order: OnTagDetected always fires before
  // OnAuthorized in the tag verifier pipeline.
  std::atomic<bool> session_was_active_at_detect_{false};

  // Current session UI state for pending-effect tracking.
  std::atomic<app_state::SessionStateUi> session_ui_state_{
      app_state::SessionStateUi::kNoSession};

  // Two independent command channels so tag and session events don't clobber
  // each other (they fire concurrently from the same dispatcher tick).
  std::atomic<TagCommand> pending_tag_cmd_{TagCommand::kNone};
  std::atomic<SessionCommand> pending_session_cmd_{SessionCommand::kNone};

  pw::async2::CoroContext coro_cx_;
  std::optional<pw::async2::CoroOrElseTask> task_;
};

}  // namespace maco::terminal_effects
