#pragma once

#include "common.h"
#include "fbs/token_session_generated.h"
#include "logic/cloud_request.h"
#include "nfc/nfc_tags.h"

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

using InternalState = std::variant<
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

 private:
  std::array<uint8_t, 7> tag_uid_;
  std::weak_ptr<oww::logic::CloudRequest> cloud_request_;
  std::weak_ptr<oww::logic::session::Sessions> sessions_;

  std::shared_ptr<start_session::InternalState> state_;
};

}  // namespace oww::logic::action
