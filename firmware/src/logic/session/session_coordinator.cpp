#include "session_coordinator.h"

#include "logic/action/start_session.h"
#include "nfc/nfc_tags.h"
#include "sessions.h"
#include "state/token_session.h"

namespace oww::logic::session {

Logger SessionCoordinator::logger("app.logic.session.coordinator");

SessionCoordinator::SessionCoordinator(
    std::shared_ptr<CloudRequest> cloud_request,
    std::shared_ptr<Sessions> sessions)
    : cloud_request_(cloud_request),
      sessions_(sessions),
      state_machine_(state::TagStateMachine::Create(
          std::in_place_type<state::tag::NoTag>)) {
  RegisterStateHandlers();
}

void SessionCoordinator::RegisterStateHandlers() {
  state_machine_->OnLoop<state::tag::NoTag>(
      [this](auto& state) { return OnNoTag(state); });
  state_machine_->OnLoop<state::tag::AuthenticatedTag>(
      [this](auto& state) { return OnAuthenticatedTag(state); });
  state_machine_->OnLoop<state::tag::SessionTag>(
      [this](auto& state) { return OnSessionTag(state); });
  state_machine_->OnLoop<state::tag::UnsupportedTag>(
      [this](auto& state) { return OnUnsupportedTag(state); });
}

state::TagStateHandle SessionCoordinator::Loop(
    const oww::nfc::NfcStateMachine::StateHandle& nfc_state) {
  // Observe NFC state transitions using StateHandle
  if (last_nfc_state_) {
    // Tag became authenticated with terminal key (decision point)
    if (nfc_state.Entered<oww::nfc::Ntag424Authenticated>(*last_nfc_state_)) {
      auto* auth = nfc_state.Get<oww::nfc::Ntag424Authenticated>();
      if (auth && state_machine_->Is<state::tag::NoTag>()) {
        logger.info(
            "Tag authenticated: %s",
            BytesToHexString(auth->uid.data(), auth->uid.size()).c_str());
        // Transition to AuthenticatedTag (decision point)
        state_machine_->TransitionTo(
            state::tag::AuthenticatedTag{.tag_uid = auth->uid});
      }
    }

    // Tag became unsupported (NFC-level rejection)
    if (nfc_state.Entered<oww::nfc::UnsupportedTag>(*last_nfc_state_) ||
        nfc_state.Entered<oww::nfc::Ntag424Unauthenticated>(*last_nfc_state_) ||
        nfc_state.Entered<oww::nfc::TagError>(*last_nfc_state_)) {
      logger.info("Unsupported tag detected");
      std::string reason = "Unbekannter Tag";
      if (nfc_state.Is<oww::nfc::Ntag424Unauthenticated>()) {
        reason = "Nicht authentifiziert";
      } else if (nfc_state.Is<oww::nfc::TagError>()) {
        reason = "Kommunikationsfehler";
      }

      std::array<uint8_t, 7> tag_uid = {};
      if (auto* unsupported = nfc_state.Get<oww::nfc::UnsupportedTag>()) {
        tag_uid = unsupported->selected_tag->nfc_id;
      } else if (auto* unauth =
                     nfc_state.Get<oww::nfc::Ntag424Unauthenticated>()) {
        tag_uid = unauth->uid;
      } else if (auto* error = nfc_state.Get<oww::nfc::TagError>()) {
        tag_uid = error->selected_tag->nfc_id;
      }

      state_machine_->TransitionTo(
          state::tag::UnsupportedTag{.tag_uid = tag_uid, .reason = reason});
    }

    // Tag removed (went back to WaitForTag)
    if (nfc_state.Entered<oww::nfc::WaitForTag>(*last_nfc_state_)) {
      logger.info("Tag removed");

      // Clear rejection timeout if transitioning away
      rejection_time_ = std::nullopt;

      state_machine_->TransitionTo(state::tag::NoTag{});
    }
  }

  last_nfc_state_ = nfc_state;

  // Run state machine
  return state_machine_->Loop();
}

// ---- State Handlers  --------------------------------------------------------

state::TagStateMachine::StateOpt SessionCoordinator::OnNoTag(
    state::tag::NoTag& state) {
  // Waiting for tag to be presented
  return std::nullopt;
}

state::TagStateMachine::StateOpt SessionCoordinator::OnAuthenticatedTag(
    state::tag::AuthenticatedTag& state) {
  // Tag authenticated with terminal key - start session creation
  logger.info("Starting session creation for tag");

  auto action = std::make_shared<action::StartSessionAction>(
      state.tag_uid, cloud_request_, sessions_);

  // Queue action to NFC worker thread
  auto queue_result = oww::nfc::NfcTags::instance().QueueAction(action);
  if (!queue_result) {
    logger.error("Failed to queue StartSessionAction");
    // Return SessionTag with Failed state
    auto failed_state_machine =
        state::session_creation::SessionCreationStateMachine::Create(
            std::in_place_type<state::session_creation::Failed>,
            state::session_creation::Failed{
                .error = ErrorType::kUnspecified,
                .message = "Failed to queue action"});
    return state::tag::SessionTag{.tag_uid = state.tag_uid,
                                  .creation_sm = failed_state_machine};
  }

  // Transition to SessionTag with action's state machine
  return state::tag::SessionTag{.tag_uid = state.tag_uid,
                                .creation_sm = action->GetStateMachine()};
}

state::TagStateMachine::StateOpt SessionCoordinator::OnSessionTag(
    state::tag::SessionTag& state) {
  // Query fresh handle from nested state machine
  auto creation_state = state.creation_sm->GetStateHandle();

  // Check if succeeded (active session)
  if (creation_state.Is<state::session_creation::Succeeded>()) {
    // Session active, monitor for tag removal (handled in Loop())
    return std::nullopt;
  }

  // Check if rejected or failed
  if (creation_state.Is<state::session_creation::Rejected>() ||
      creation_state.Is<state::session_creation::Failed>()) {
    // Log rejection on first entry
    if (!rejection_time_) {
      if (auto* rejected =
              creation_state.Get<state::session_creation::Rejected>()) {
        logger.warn("Session creation rejected: %s", rejected->message.c_str());
      } else if (auto* failed =
                     creation_state.Get<state::session_creation::Failed>()) {
        logger.error("Session creation failed: %s", failed->message.c_str());
      }
      rejection_time_ = timeUtc();
    }

    // Check timeout (5 seconds)
    if (timeUtc() - *rejection_time_ > std::chrono::seconds(5)) {
      logger.info("Rejection timeout expired, returning to no tag");
      rejection_time_ = std::nullopt;
      return state::tag::NoTag{};
    }

    // Stay in rejected state
    return std::nullopt;
  }

  // Session creation in progress (Begin, Await*)
  return std::nullopt;
}

state::TagStateMachine::StateOpt SessionCoordinator::OnUnsupportedTag(
    state::tag::UnsupportedTag& state) {
  // Show unsupported tag message briefly, then wait for tag removal
  // Tag removal is handled in Loop() NFC observation
  return std::nullopt;
}

}  // namespace oww::logic::session
