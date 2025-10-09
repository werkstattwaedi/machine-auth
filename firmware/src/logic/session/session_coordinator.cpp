#include "session_coordinator.h"

#include "logic/action/start_session.h"
#include "nfc/nfc_tags.h"
#include "sessions.h"
#include "token_session.h"

namespace oww::logic::session {

Logger SessionCoordinator::logger("session_coordinator");

SessionCoordinator::SessionCoordinator(
    std::shared_ptr<CloudRequest> cloud_request,
    std::shared_ptr<Sessions> sessions)
    : cloud_request_(cloud_request),
      sessions_(sessions),
      state_machine_(SessionStateMachine::Create(
          std::in_place_type<coordinator_state::Idle>)) {
  RegisterStateHandlers();
}

void SessionCoordinator::RegisterStateHandlers() {
  state_machine_->OnLoop<coordinator_state::Idle>(
      [this](auto& state) { return OnIdle(state); });
  state_machine_->OnLoop<coordinator_state::WaitingForTag>(
      [this](auto& state) { return OnWaitingForTag(state); });
  state_machine_->OnLoop<coordinator_state::AuthenticatingTag>(
      [this](auto& state) { return OnAuthenticatingTag(state); });
  state_machine_->OnLoop<coordinator_state::SessionActive>(
      [this](auto& state) { return OnSessionActive(state); });
  state_machine_->OnLoop<coordinator_state::Rejected>(
      [this](auto& state) { return OnRejected(state); });
}

SessionStateHandle SessionCoordinator::Loop(
    const oww::nfc::NfcStateMachine::StateHandle& nfc_state) {
  // Observe NFC state transitions using StateHandle
  if (last_nfc_state_) {
    // Tag became authenticated with terminal key
    if (nfc_state.Entered<oww::nfc::Ntag424Authenticated>(*last_nfc_state_)) {
      auto* auth = nfc_state.Get<oww::nfc::Ntag424Authenticated>();
      if (auth && state_machine_->Is<coordinator_state::Idle>()) {
        logger.info("Tag authenticated: %s", BytesToHexString(auth->uid.data(), auth->uid.size()).c_str());
        // Transition to WaitingForTag, state handler will start auth
        state_machine_->TransitionTo(coordinator_state::WaitingForTag{});
      }
    }

    // Tag removed (went back to WaitForTag)
    if (nfc_state.Exited<oww::nfc::Ntag424Authenticated>(*last_nfc_state_)) {
      logger.info("Tag removed");
      // Return to idle (will trigger session cleanup if needed)
      if (!state_machine_->Is<coordinator_state::Idle>()) {
        state_machine_->TransitionTo(coordinator_state::Idle{});
      }
    }
  }

  last_nfc_state_ = nfc_state;

  // Run state machine
  return state_machine_->Loop();
}

std::shared_ptr<TokenSession> SessionCoordinator::GetActiveSession() const {
  if (auto* active =
          state_machine_->Get<coordinator_state::SessionActive>()) {
    return active->session;
  }
  return nullptr;
}

bool SessionCoordinator::HasActiveSession() const {
  return state_machine_->Is<coordinator_state::SessionActive>();
}

// ---- State Handlers --------------------------------------------------------

SessionStateMachine::StateOpt SessionCoordinator::OnIdle(
    coordinator_state::Idle& state) {
  // Waiting for tag to be presented
  return std::nullopt;
}

SessionStateMachine::StateOpt SessionCoordinator::OnWaitingForTag(
    coordinator_state::WaitingForTag& state) {
  // Get current NFC state to extract tag UID
  auto nfc_state = oww::nfc::NfcTags::instance().GetNfcStateHandle();
  auto* auth = nfc_state.Get<oww::nfc::Ntag424Authenticated>();

  if (!auth) {
    // Tag was removed before we could start, go back to idle
    return coordinator_state::Idle{};
  }

  // Check if session already exists
  auto existing_session = sessions_->GetSessionForToken(auth->uid);
  if (existing_session) {
    logger.info("Existing session found for tag");
    return coordinator_state::SessionActive{.tag_uid = auth->uid,
                                            .session = existing_session};
  }

  // No existing session, need to authenticate with cloud
  logger.info("Starting cloud authentication for tag");

  auto action = std::make_shared<action::StartSessionAction>(
      auth->uid, cloud_request_, sessions_);

  // Queue action to NFC worker thread
  auto queue_result = oww::nfc::NfcTags::instance().QueueAction(action);
  if (!queue_result) {
    logger.error("Failed to queue StartSessionAction");
    return coordinator_state::Rejected{
        .message = "Failed to start authentication",
        .time = timeUtc(),
    };
  }

  return coordinator_state::AuthenticatingTag{.tag_uid = auth->uid,
                                              .action = action};
}

SessionStateMachine::StateOpt SessionCoordinator::OnAuthenticatingTag(
    coordinator_state::AuthenticatingTag& state) {
  // Poll action completion
  if (!state.action->IsComplete()) {
    return std::nullopt;  // Still waiting
  }

  // Action completed, check result
  auto action_state = state.action->GetState();

  if (auto* succeeded =
          std::get_if<action::start_session::Succeeded>(action_state.get())) {
    logger.info("Authentication succeeded for user: %s",
                succeeded->session->GetUserLabel().c_str());
    return coordinator_state::SessionActive{.tag_uid = state.tag_uid,
                                            .session = succeeded->session};
  }

  if (auto* rejected =
          std::get_if<action::start_session::Rejected>(action_state.get())) {
    logger.warn("Authentication rejected: %s", rejected->message.c_str());
    return coordinator_state::Rejected{.message = rejected->message,
                                       .time = timeUtc()};
  }

  if (auto* failed =
          std::get_if<action::start_session::Failed>(action_state.get())) {
    logger.error("Authentication failed: %s", failed->message.c_str());
    return coordinator_state::Rejected{.message = "Authentication failed",
                                       .time = timeUtc()};
  }

  // Should not reach here
  logger.error("Unexpected action state");
  return coordinator_state::Idle{};
}

SessionStateMachine::StateOpt SessionCoordinator::OnSessionActive(
    coordinator_state::SessionActive& state) {
  // Session is active, just monitoring for tag removal
  // (handled in Loop() by observing NFC state)
  return std::nullopt;
}

SessionStateMachine::StateOpt SessionCoordinator::OnRejected(
    coordinator_state::Rejected& state) {
  // Show rejection for a few seconds, then return to idle
  if (timeUtc() - state.time > std::chrono::seconds(5)) {
    return coordinator_state::Idle{};
  }
  return std::nullopt;
}

}  // namespace oww::logic::session
