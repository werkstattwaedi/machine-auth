#pragma once

#include "common.h"
#include "state/state_machine.h"
#include "logic/action/start_session.h"
#include "logic/cloud_request.h"
#include "nfc/states.h"

namespace oww::state {
class TokenSession;
}

namespace oww::logic::session {

class Sessions;

namespace coordinator_state {

struct Idle {};

struct WaitingForTag {};

struct AuthenticatingTag {
  std::array<uint8_t, 7> tag_uid;
  std::shared_ptr<action::StartSessionAction> action;
};

struct SessionActive {
  std::array<uint8_t, 7> tag_uid;
  std::shared_ptr<oww::state::TokenSession> session;
};

struct Rejected {
  std::string message;
  std::chrono::time_point<std::chrono::system_clock> time;
};

}  // namespace coordinator_state

using SessionStateMachine = oww::state::StateMachine<
    coordinator_state::Idle, coordinator_state::WaitingForTag,
    coordinator_state::AuthenticatingTag, coordinator_state::SessionActive,
    coordinator_state::Rejected>;

using SessionStateHandle = SessionStateMachine::StateHandle;

class SessionCoordinator {
 public:
  SessionCoordinator(std::shared_ptr<CloudRequest> cloud_request,
                     std::shared_ptr<Sessions> sessions);

  // Called from Application::Loop()
  // Takes NFC state as input, returns session state
  SessionStateHandle Loop(
      const oww::nfc::NfcStateMachine::StateHandle& nfc_state);

  // Query current session (thread-safe)
  std::shared_ptr<oww::state::TokenSession> GetActiveSession() const;
  bool HasActiveSession() const;

  // Thread-safe state query (for UI/Application)
  SessionStateHandle GetStateHandle() { return state_machine_->GetStateHandle(); }

 private:
  static Logger logger;

  std::shared_ptr<CloudRequest> cloud_request_;
  std::shared_ptr<Sessions> sessions_;

  std::shared_ptr<SessionStateMachine> state_machine_;
  std::optional<oww::nfc::NfcStateMachine::StateHandle> last_nfc_state_;

  void RegisterStateHandlers();

  // State handlers
  SessionStateMachine::StateOpt OnIdle(coordinator_state::Idle& state);
  SessionStateMachine::StateOpt OnWaitingForTag(
      coordinator_state::WaitingForTag& state);
  SessionStateMachine::StateOpt OnAuthenticatingTag(
      coordinator_state::AuthenticatingTag& state);
  SessionStateMachine::StateOpt OnSessionActive(
      coordinator_state::SessionActive& state);
  SessionStateMachine::StateOpt OnRejected(coordinator_state::Rejected& state);
};

}  // namespace oww::logic::session
