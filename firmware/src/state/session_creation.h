#pragma once

#include <array>
#include <memory>
#include <string>

#include "cloud_response.h"
#include "common/status.h"
#include "fbs/token_session_generated.h"
#include "state/state_machine.h"

namespace oww::state {
class TokenSession;
}

namespace oww::state::session_creation {

// Session creation begins
struct Begin {};

// Waiting for StartSession cloud response
struct AwaitStartSessionResponse {
  const std::shared_ptr<CloudResponse<fbs::StartSessionResponseT>> response;
};

// Waiting for AuthenticateNewSession cloud response
struct AwaitAuthenticateNewSessionResponse {
  const std::shared_ptr<CloudResponse<fbs::AuthenticateNewSessionResponseT>>
      response;
};

// Waiting for CompleteAuthentication cloud response
struct AwaitCompleteAuthenticationResponse {
  const std::shared_ptr<CloudResponse<fbs::CompleteAuthenticationResponseT>>
      response;
};

// Session creation succeeded
struct Succeeded {
  std::shared_ptr<oww::state::TokenSession> session;
};

// Session creation rejected by backend
struct Rejected {
  std::string message;
};

// Session creation failed due to error
struct Failed {
  const ErrorType error;
  const std::string message;
};

using SessionCreationStateMachine = oww::state::StateMachine<
    Begin, AwaitStartSessionResponse, AwaitAuthenticateNewSessionResponse,
    AwaitCompleteAuthenticationResponse, Succeeded, Rejected, Failed>;

using SessionCreationStateHandle = SessionCreationStateMachine::StateHandle;

}  // namespace oww::state::session_creation
