#include "start_session.h"

#include <type_traits>

#include "../../config.h"
#include "common/byte_array.h"
#include "state/configuration.h"
#include "state/state.h"

namespace oww::state::session {
using namespace start;
using namespace config::tag;
using namespace fbs;

void UpdateNestedState(oww::state::State &state_manager,
                       StartSession last_state,
                       NestedState updated_nested_state) {
  state_manager.lock();
  state_manager.OnNewState(StartSession{
      .tag_uid = last_state.tag_uid,
      .state = std::make_shared<start::NestedState>(updated_nested_state)});
  state_manager.unlock();
}

void OnBegin(StartSession state, Begin &begin,
             oww::state::State &state_manager) {
  auto existing_session =
      state_manager.GetSessions().GetSessionForToken(state.tag_uid);

  if (existing_session) {
    return UpdateNestedState(state_manager, state,
                             Succeeded{.session = existing_session});
  }

  StartSessionRequestT request;
  request.token_id =
      std::make_unique<TagUid>(flatbuffers::span<uint8_t, 7>(state.tag_uid));

  UpdateNestedState(
      state_manager, state,
      AwaitStartSessionResponse{
          .response = state_manager.SendTerminalRequest<StartSessionRequestT,
                                                        StartSessionResponseT>(
              "startSession", request)});
}

void OnStartSessionResponse(StartSession state,
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
    case StartSessionResult::TokenSession: {
      // ---- EXISTING SESSION ------------------------------------------------
      auto token_session_data = start_session_response->result.AsTokenSession();

      if (!token_session_data) {
        return UpdateNestedState(
            state_manager, state,
            Failed{.error = ErrorType::kMalformedResponse,
                   .message = "StartSessionResult is missing TokenSession"});
      }

      auto existing_session =
          state_manager.GetSessions().RegisterSession(*token_session_data);
      return UpdateNestedState(state_manager, state,
                               Succeeded{.session = existing_session});
    }
    case StartSessionResult::AuthRequired: {
      // ---- AUTH REQUIRED ---------------------------------------------------
      auto auth_challenge = ntag_interface.AuthenticateWithCloud_Begin(
          config::tag::key_authorization);

      if (!auth_challenge) {
        Log.error("AuthenticateWithCloud_Begin failed [dna:%d]",
                  auth_challenge.error());
        if (auth_challenge.error() ==
            Ntag424::DNA_StatusCode::AUTHENTICATION_DELAY) {
          // Need to retry until successful
          return;
        }

        return UpdateNestedState(
            state_manager, state,
            Failed{.tag_status = auth_challenge.error(),
                   .message = String::format(
                       "AuthenticateWithCloud_Begin failed [dna:%d]",
                       auth_challenge.error())});
      }

      AuthenticateNewSessionRequestT request;
      request.token_id = std::make_unique<TagUid>(
          flatbuffers::span<uint8_t, 7>(state.tag_uid));
      request.ntag_challenge.assign(auth_challenge->begin(),
                                    auth_challenge->end());

      return UpdateNestedState(
          state_manager, state,
          AwaitAuthenticateNewSessionResponse{
              .response =
                  state_manager
                      .SendTerminalRequest<AuthenticateNewSessionRequestT,
                                           AuthenticateNewSessionResponseT>(
                          "authenticateNewSession", request)});
    }
    case StartSessionResult::Rejected: {
      // ---- REJECTED --------------------------------------------------------
      return UpdateNestedState(
          state_manager, state,
          Rejected{.message =
                       start_session_response->result.AsRejected()->message});
    }
    default: {
      // ---- MALFORMED RESPONSE ----------------------------------------------
      return UpdateNestedState(
          state_manager, state,
          Failed{.error = ErrorType::kMalformedResponse,
                 .message = "Unknown StartSessionResult type"});
    }
  }
}

void OnAuthenticateNewSessionResponse(
    StartSession state, AwaitAuthenticateNewSessionResponse &response_holder,
    Ntag424 &ntag_interface, oww::state::State &state_manager) {
  auto cloud_response = response_holder.response.get();
  if (IsPending(*cloud_response)) {
    return;
  }

  auto auth_new_session_response =
      std::get_if<AuthenticateNewSessionResponseT>(cloud_response);
  if (!auth_new_session_response) {
    return UpdateNestedState(
        state_manager, state,
        Failed{.error = std::get<ErrorType>(*cloud_response)});
  }

  auto cloud_challenge = auth_new_session_response->cloud_challenge;

  std::array<byte, 32> challenge_array;
  std::copy(cloud_challenge.begin(), cloud_challenge.end(),
            challenge_array.begin());

  auto encrypted_response =
      ntag_interface.AuthenticateWithCloud_Part2(challenge_array);

  if (!encrypted_response) {
    return UpdateNestedState(
        state_manager, state,
        Failed{.tag_status = encrypted_response.error(),
               .message =
                   String::format("AuthenticateWithCloud_Part2 failed [dna:%d]",
                                  encrypted_response.error())});
  }

  CompleteAuthenticationRequestT complete_auth_request{
      .session_id = auth_new_session_response->session_id};
  complete_auth_request.encrypted_ntag_response.assign(
      encrypted_response->begin(), encrypted_response->end());

  UpdateNestedState(
      state_manager, state,
      AwaitCompleteAuthenticationResponse{
          .response = state_manager.SendTerminalRequest<
              CompleteAuthenticationRequestT, CompleteAuthenticationResponseT>(
              "completeAuthentication", complete_auth_request)});
}

void OnCompleteAuthenticationResponse(
    StartSession state, AwaitCompleteAuthenticationResponse &response_holder,
    oww::state::State &state_manager) {
  auto cloud_response = response_holder.response.get();
  if (IsPending(*cloud_response)) {
    return;
  }

  auto complete_auth_response =
      std::get_if<CompleteAuthenticationResponseT>(cloud_response);
  if (!complete_auth_response) {
    return UpdateNestedState(
        state_manager, state,
        Failed{.error = std::get<ErrorType>(*cloud_response)});
  }

  switch (complete_auth_response->result.type) {
    case CompleteAuthenticationResult::TokenSession: {
      // ---- SESSION CREATED ------------------------------------------------
      auto token_session_data = complete_auth_response->result.AsTokenSession();

      if (!token_session_data) {
        return UpdateNestedState(
            state_manager, state,
            Failed{.error = ErrorType::kMalformedResponse,
                   .message =
                       "CompleteAuthenticationResult is missing TokenSession"});
      }

      auto existing_session =
          state_manager.GetSessions().RegisterSession(*token_session_data);
      return UpdateNestedState(state_manager, state,
                               Succeeded{.session = existing_session});
    }
    case CompleteAuthenticationResult::Rejected: {
      // ---- REJECTED --------------------------------------------------------
      return UpdateNestedState(
          state_manager, state,
          Rejected{.message =
                       complete_auth_response->result.AsRejected()->message});
    }
    default: {
      // ---- MALFORMED RESPONSE ----------------------------------------------
      return UpdateNestedState(
          state_manager, state,
          Failed{.error = ErrorType::kMalformedResponse,
                 .message = "Unknown CompleteAuthenticationResult type"});
    }
  }
}

// ---- Loop dispatchers ------------------------------------------------------

void Loop(StartSession state, oww::state::State &state_manager,
          Ntag424 &ntag_interface) {
  if (auto nested = std::get_if<Begin>(state.state.get())) {
    OnBegin(state, *nested, state_manager);
  } else if (auto nested =
                 std::get_if<AwaitStartSessionResponse>(state.state.get())) {
    OnStartSessionResponse(state, *nested, ntag_interface, state_manager);
  } else if (auto nested = std::get_if<AwaitAuthenticateNewSessionResponse>(
                 state.state.get())) {
    OnAuthenticateNewSessionResponse(state, *nested, ntag_interface,
                                     state_manager);
  } else if (auto nested = std::get_if<AwaitCompleteAuthenticationResponse>(
                 state.state.get())) {
    OnCompleteAuthenticationResponse(state, *nested, state_manager);
  }
}

}  // namespace oww::state::session