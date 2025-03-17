#include "authorize.h"

#include "../../config.h"
#include "common/hex_util.h"

namespace oww::state::tag {
using namespace authorize;

Authorize Authorize::WithNestedState(authorize::State nested_state) {
  return Authorize{.tag_uid = this->tag_uid,
                   .state = std::make_shared<State>(nested_state)};
}

std::optional<Authorize> StateLoop(Authorize authorize_state,
                                   CloudRequest &cloud_interface) {
  auto nested_state = authorize_state.state;
  if (auto state = std::get_if<NtagChallenge>(nested_state.get())) {
    auto encoded_challenge = BytesToHexString(state->auth_challenge);
    auto encoded_uid = BytesToHexString(authorize_state.tag_uid);

    Variant payload;
    payload.set("uid", Variant(encoded_uid.c_str()));
    payload.set("challenge", Variant(encoded_challenge.c_str()));

    auto request_id =
        cloud_interface.SendTerminalRequest("authenticate-part1", payload);
    if (!request_id) {
      return authorize_state.WithNestedState(
          Failed{.tag_status = Ntag424::DNA_StatusCode::DNA_STATUS_ERROR});
    }

    return authorize_state.WithNestedState(
        AwaitCloudChallenge{.request_id = request_id.value()});
  }
  return {};
}


std::optional<Authorize> NfcLoop(Authorize authorize_state,
  Ntag424 &ntag_interface) {
auto nested_state = authorize_state.state;
if (auto state = std::get_if<Start>(nested_state.get())) {

  auto auth_challenge =
  ntag_interface.AuthenticateWithCloud_Begin(state.key_number);
if (!auth_challenge) {
return Failed{.tag_status = auth_challenge.error()};
}

return {NtagChallenge{.auth_challenge = auth_challenge.value()}};


auto encoded_challenge = BytesToHexString(state->auth_challenge);
auto encoded_uid = BytesToHexString(authorize_state.tag_uid);

Variant payload;
payload.set("uid", Variant(encoded_uid.c_str()));
payload.set("challenge", Variant(encoded_challenge.c_str()));

auto request_id =
cloud_interface.SendTerminalRequest("authenticate-part1", payload);
if (!request_id) {
return authorize_state.WithNestedState(
Failed{.tag_status = Ntag424::DNA_StatusCode::DNA_STATUS_ERROR});
}

return authorize_state.WithNestedState(
AwaitCloudChallenge{.request_id = request_id.value()});
}
return {};
}



namespace authorize {

State HandleStart(Start state, Ntag424 &ntag_interface) {
  auto auth_challenge =
      ntag_interface.AuthenticateWithCloud_Begin(state.key_number);
  if (!auth_challenge) {
    return Failed{.tag_status = auth_challenge.error()};
  }

  return {NtagChallenge{.auth_challenge = auth_challenge.value()}};
}


}  // namespace authorize
}  // namespace oww::state::tag