#pragma once

#include "common.h"
#include "fbs/token_session_generated.h"
#include "nfc/driver/Ntag424.h"
#include "state/cloud_response.h"

namespace oww::state {
class State;
}  // namespace oww::state

namespace oww::state::token_session {

namespace start {

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
  std::shared_ptr<TokenSession> session;
};

struct Rejected {
  std::string message;
};

struct Failed {
  const ErrorType error;
  const Ntag424::DNA_StatusCode tag_status;
  const String message;
};
using NestedState = std::variant<
    Begin, AwaitStartSessionResponse, AwaitAuthenticateNewSessionResponse,
    AwaitCompleteAuthenticationResponse, Succeeded, Rejected, Failed>;

}  // namespace start

struct StartSession {
  std::array<uint8_t, 7> tag_uid;
  std::shared_ptr<start::NestedState> state;
};

void Loop(StartSession start_session_state, oww::state::State &state_manager,
          Ntag424 &ntag_interface);

}  // namespace oww::state::token_session
