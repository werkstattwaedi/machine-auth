#include "start_session.h"

#include <type_traits>

#include "../../config.h"
#include "common/byte_array.h"
#include "state/configuration.h"
#include "state/state.h"

namespace oww::state::terminal {
using namespace start;
using namespace config::tag;
using namespace oww::session;

void UpdateNestedState(
    oww::state::State &state_manager, StartSession last_state,
    oww::state::terminal::start::State updated_nested_state) {
  state_manager.lock();
  state_manager.OnNewState(StartSession{
      .tag_uid = last_state.tag_uid,
      .machine_id = last_state.machine_id,
      .state = std::make_shared<start::State>(updated_nested_state)});
  state_manager.unlock();
}

template <typename AuthenticationT>
void UpdateStartSessionRequest(StartSession last_state,
                               AuthenticationT authentication,
                               oww::state::State &state_manager) {
  StartSessionRequestT request;
  request.machine_id = last_state.machine_id;
  request.token_id = std::make_unique<oww::ntag::TagUid>(
      flatbuffers::span<uint8_t, 7>(last_state.tag_uid));

  request.authentication.Set(authentication);

  UpdateNestedState(
      state_manager, last_state,
      AwaitStartSessionResponse{
          .response = state_manager.SendTerminalRequest<StartSessionRequestT,
                                                        StartSessionResponseT>(
              "startSession", request)});
}

void OnStartWithRecentAuth(StartSession state, StartWithRecentAuth &start,
                           oww::state::State &state_manager) {
  RecentAuthenticationT authentication;
  authentication.token = start.recent_auth_token;

  UpdateStartSessionRequest(state, authentication, state_manager);
}

void OnStartWithNfcAuth(StartSession state, StartWithNfcAuth &start,
                        Ntag424 &ntag_interface,
                        oww::state::State &state_manager) {
  auto auth_challenge = ntag_interface.AuthenticateWithCloud_Begin(
      config::tag::key_authorization);

  if (!auth_challenge) {
    return UpdateNestedState(
        state_manager, state,
        Failed{.tag_status = auth_challenge.error(),
               .message =
                   String::format("AuthenticateEV2First_Part1 failed [dna:%d]",
                                  auth_challenge.error())});
  }

  FirstAuthenticationT authentication;
  authentication.ntag_challenge.assign(auth_challenge->begin(),
                                       auth_challenge->end());

  UpdateStartSessionRequest(state, authentication, state_manager);
}

void OnAwaitStartSessionResponse(StartSession state,
                                 AwaitStartSessionResponse &response_holder,
                                 oww::state::State &state_manager) {
  auto cloud_response = response_holder.response.get();
  if (IsPending(*cloud_response)) {
    return;
  }

  auto start_session_response =
      std::get_if<StartSessionResponseT>(cloud_response);
  if (!start_session_response) {
    return UpdateNestedState(
        state_manager, state,
        Failed{.error = std::get<ErrorType>(*cloud_response)});
  }

  switch (start_session_response->result.type) {
    case oww::session::AuthorizationResult::StateAuthorized:
      return UpdateNestedState(
          state_manager, state,
          Succeeded{.session_id = start_session_response->session_id});
    case oww::session::AuthorizationResult::StateRejected:
      return UpdateNestedState(
          state_manager, state,
          Rejected{
              .message =
                  start_session_response->result.AsStateRejected()->message});
    case oww::session::AuthorizationResult::AuthenticationPart2:
      // FIXME IMPLEMENT
    default:
      return UpdateNestedState(
          state_manager, state,
          Failed{.error = ErrorType::kMalformedResponse,
                 .message = "Unknown AuthorizationResult type"});
  }
}

// ---- Loop dispatchers ------------------------------------------------------

void Loop(StartSession state, oww::state::State &state_manager,
          Ntag424 &ntag_interface) {
  if (auto nested = std::get_if<StartWithRecentAuth>(state.state.get())) {
    OnStartWithRecentAuth(state, *nested, state_manager);
  } else if (auto nested = std::get_if<StartWithNfcAuth>(state.state.get())) {
    OnStartWithNfcAuth(state, *nested, ntag_interface, state_manager);
  } else if (auto nested =
                 std::get_if<AwaitStartSessionResponse>(state.state.get())) {
    OnAwaitStartSessionResponse(state, *nested, state_manager);
  }
}

}  // namespace oww::state::terminal