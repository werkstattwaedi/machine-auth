#pragma once

#include "app/cloud_response.h"
#include "common.h"
#include "fbs/token_session_generated.h"
#include "nfc/nfc_tags.h"

namespace oww::app::session {
class TokenSession;
class Sessions;
}  // namespace oww::app::session

namespace oww::app::action {

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
  std::shared_ptr<oww::app::session::TokenSession> session;
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

class StartSessionAction : public NtagAction {
 public:
  StartSessionAction(std::array<uint8_t, 7> tag_uid,
                     std::weak_ptr<oww::app::CloudRequest> cloud_request,
                     std::weak_ptr<oww::app::session::Sessions> sessions);
  ~StartSessionAction() {}

  virtual Continuation Loop(Ntag424 &ntag_interface);
  virtual void OnAbort(ErrorType error);

  bool IsComplete();

 private:
  std::array<uint8_t, 7> tag_uid_;
  std::weak_ptr<oww::app::CloudRequest> cloud_request_;
  std::weak_ptr<oww::app::session::Sessions> sessions_;

  std::shared_ptr<start_session::InternalState> state_;
};

}  // namespace oww::app::action
