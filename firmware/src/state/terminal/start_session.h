#pragma once

#include "common.h"
#include "fbs/session_generated.h"
#include "nfc/driver/Ntag424.h"
#include "state/cloud_response.h"

namespace oww::state {
class State;
}  // namespace oww::state

namespace oww::state::terminal {

namespace start {

struct StartWithRecentAuth {
  String recent_auth_token;
};

struct StartWithNfcAuth {};

struct AwaitStartSessionResponse {
  const std::shared_ptr<CloudResponse<oww::session::StartSessionResponseT>>
      response;
};

struct AwaitAuthenticatePart2Response {
  const std::shared_ptr<CloudResponse<oww::session::AuthenticatePart2ResponseT>>
      response;
};

struct Succeeded {
  std::string session_id;
};

struct Rejected {
  std::string message;
};

struct Failed {
  const ErrorType error;
  const Ntag424::DNA_StatusCode tag_status;
  const String message;
};
using State =
    std::variant<StartWithRecentAuth, StartWithNfcAuth,
                 AwaitStartSessionResponse, AwaitAuthenticatePart2Response,
                 Succeeded, Rejected, Failed>;

}  // namespace start

struct StartSession {
  std::array<uint8_t, 7> tag_uid;
  std::string machine_id;
  std::shared_ptr<start::State> state;
};

void Loop(StartSession start_session_state, oww::state::State &state_manager,
          Ntag424 &ntag_interface);

}  // namespace oww::state::terminal
