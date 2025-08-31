#include "start_session.h"

#include <type_traits>

#include "../../config.h"
#include "common/byte_array.h"
#include "state/configuration.h"
#include "state/state.h"

namespace oww::state::tag {
using namespace start;
using namespace config::tag;
using namespace oww::session;

void UpdateNestedState(oww::state::State &state_manager,
                       StartSession last_state,
                       oww::state::tag::start::State updated_nested_state) {
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
    Log.error("OnStartWithNfcAuth failed  [dna:%d]", auth_challenge.error());
    if (auth_challenge.error() ==
        Ntag424::DNA_StatusCode::AUTHENTICATION_DELAY) {
      // Need to retry until successful
      return;
    }

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
                                 Ntag424 &ntag_interface,
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

    {
      auto auth_part2 = start_session_response->result.AsAuthenticationPart2();
      auto cloud_challenge = auth_part2->cloud_challenge;

      std::array<byte, 32> challenge_array;
      std::copy(cloud_challenge.begin(), cloud_challenge.end(),
                challenge_array.begin());

      auto encrypted_response =
          ntag_interface.AuthenticateWithCloud_Part2(challenge_array);

      if (!encrypted_response) {
        return UpdateNestedState(
            state_manager, state,
            Failed{.tag_status = encrypted_response.error(),
                   .message = String::format(
                       "AuthenticateEV2First_Part2 failed [dna:%d]",
                       encrypted_response.error())});
      }

      oww::session::AuthenticatePart2RequestT auth_part2_request{
          .session_id = start_session_response->session_id};
      auth_part2_request.encrypted_ntag_response.assign(
          encrypted_response->begin(), encrypted_response->end());

      UpdateNestedState(
          state_manager, state,
          AwaitAuthenticatePart2Response{
              .response =
                  state_manager.SendTerminalRequest<AuthenticatePart2RequestT,
                                                    AuthenticatePart2ResponseT>(
                      "authenticatePart2", auth_part2_request)});
      return;
    }
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
    OnAwaitStartSessionResponse(state, *nested, ntag_interface, state_manager);
  }
}

}  // namespace oww::state::tag