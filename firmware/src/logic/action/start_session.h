#pragma once

#include "common.h"
#include "fbs/token_session_generated.h"
#include "logic/cloud_request.h"
#include "nfc/nfc_tags.h"
#include "state/state_machine.h"

namespace oww::logic::session {
class TokenSession;
class Sessions;
}  // namespace oww::logic::session

namespace oww::logic::action {

namespace start_session {

struct Begin {};

struct AwaitStartSessionResponse {
  const std::shared_ptr<CloudResponse<fbs::StartSessionResponseT>> response;
};

struct AwaitAuthenticateNewSessionResponse {
  const std::shared_ptr<CloudResponse<fbs::AuthenticateNewSessionResponseT>>
      response;
};

struct AwaitCompleteAuthenticationResponse {
  const std::shared_ptr<CloudResponse<fbs::CompleteAuthenticationResponseT>>
      response;
};

struct Succeeded {
  std::shared_ptr<oww::logic::session::TokenSession> session;
};

struct Rejected {
  std::string message;
};

struct Failed {
  const ErrorType error;
  const String message;
};

using SessionCreationStateMachine = oww::common::StateMachine<
    Begin, AwaitStartSessionResponse, AwaitAuthenticateNewSessionResponse,
    AwaitCompleteAuthenticationResponse, Succeeded, Rejected, Failed>;

}  // namespace start_session

class StartSessionAction : public oww::nfc::NtagAction {
 public:
  StartSessionAction(std::array<uint8_t, 7> tag_uid,
                     std::weak_ptr<oww::logic::CloudRequest> cloud_request,
                     std::weak_ptr<oww::logic::session::Sessions> sessions);
  ~StartSessionAction() {}

  virtual Continuation Loop(Ntag424& ntag_interface);
  virtual void OnAbort(ErrorType error);

  bool IsComplete();
  start_session::SessionCreationStateMachine::StateHandle GetState() const {
    return state_machine_->GetStateHandle();
  }

 private:
  void RegisterStateHandlers();

  std::array<uint8_t, 7> tag_uid_;

  // Strong references - keep dependencies alive for action lifetime
  std::shared_ptr<oww::logic::CloudRequest> cloud_request_;
  std::shared_ptr<oww::logic::session::Sessions> sessions_;

  // Ntag interface reference (valid only during Loop())
  Ntag424* ntag_interface_ = nullptr;

  std::shared_ptr<start_session::SessionCreationStateMachine> state_machine_;
};

}  // namespace oww::logic::action
