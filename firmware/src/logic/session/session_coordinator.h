#pragma once

#include "common.h"
#include "state/state_machine.h"
#include "state/tag_state.h"
#include "logic/action/start_session.h"
#include "logic/cloud_request.h"
#include "nfc/states.h"

namespace oww::state {
class TokenSession;
}

namespace oww::logic::session {

class Sessions;

class SessionCoordinator {
 public:
  SessionCoordinator(std::shared_ptr<CloudRequest> cloud_request,
                     std::shared_ptr<Sessions> sessions);

  // Called from Application::Loop()
  // Takes NFC state as input, returns tag state
  oww::state::TagStateHandle Loop(
      const oww::nfc::NfcStateMachine::StateHandle& nfc_state);

  // Thread-safe state query (for UI/Application)
  oww::state::TagStateHandle GetStateHandle() const { return state_machine_->GetStateHandle(); }

 private:
  static Logger logger;

  std::shared_ptr<CloudRequest> cloud_request_;
  std::shared_ptr<Sessions> sessions_;

  std::shared_ptr<oww::state::TagStateMachine> state_machine_;
  std::optional<oww::nfc::NfcStateMachine::StateHandle> last_nfc_state_;

  // Rejection timeout tracking (logic-layer concern)
  std::optional<std::chrono::time_point<std::chrono::system_clock>> rejection_time_;

  void RegisterStateHandlers();

  // State handlers
  oww::state::TagStateMachine::StateOpt OnNoTag(oww::state::tag::NoTag& state);
  oww::state::TagStateMachine::StateOpt OnAuthenticatedTag(
      oww::state::tag::AuthenticatedTag& state);
  oww::state::TagStateMachine::StateOpt OnSessionTag(
      oww::state::tag::SessionTag& state);
  oww::state::TagStateMachine::StateOpt OnUnsupportedTag(
      oww::state::tag::UnsupportedTag& state);
};

}  // namespace oww::logic::session
