#include "start_session.h"

#include <type_traits>

#include "common/byte_array.h"
#include "config.h"
#include "logic/application.h"
#include "logic/configuration.h"

namespace oww::logic::action {

Logger logger("app.logic.action.start_session");

using namespace oww::state::session_creation;
using namespace oww::logic::session;
using namespace config::tag;
using namespace fbs;
using namespace oww::nfc;
using oww::logic::CloudRequest;

SessionCreationStateMachine::StateOpt OnBegin(
    Begin& state, std::array<uint8_t, 7> tag_uid, Sessions& sessions,
    CloudRequest& cloud_request) {
  auto existing_session = sessions.GetSessionForToken(tag_uid);

  if (existing_session) {
    return Succeeded{.session = existing_session};
  }

  StartSessionRequestT request;
  request.token_id =
      std::make_unique<TagUid>(flatbuffers::span<uint8_t, 7>(tag_uid));

  auto response =
      cloud_request
          .SendTerminalRequest<StartSessionRequestT, StartSessionResponseT>(
              "startSession", request);

  return AwaitStartSessionResponse{.response = response};
}

SessionCreationStateMachine::StateOpt OnAwaitStartSession(
    AwaitStartSessionResponse& state, std::array<uint8_t, 7> tag_uid,
    Sessions& sessions, CloudRequest& cloud_request, Ntag424& ntag_interface) {
  auto cloud_response = state.response.get();
  if (state::IsPending(*cloud_response)) {
    return std::nullopt;  // Stay in current state
  }

  auto start_session_response =
      std::get_if<StartSessionResponseT>(cloud_response);
  if (!start_session_response) {
    return Failed{.error = std::get<ErrorType>(*cloud_response),
                  .message = "Cloud request failed"};
  }

  switch (start_session_response->result.type) {
    case StartSessionResult::TokenSession: {
      // ---- EXISTING SESSION ------------------------------------------------
      auto token_session_data = start_session_response->result.AsTokenSession();
      if (!token_session_data) {
        return Failed{.error = ErrorType::kMalformedResponse,
                      .message = "Missing TokenSession"};
      }

      auto existing_session = sessions.RegisterSession(*token_session_data);
      return Succeeded{.session = existing_session};
    }
    case StartSessionResult::AuthRequired: {
      // ---- AUTH REQUIRED ---------------------------------------------------
      auto auth_challenge = ntag_interface.AuthenticateWithCloud_Begin(
          config::tag::key_authorization);

      if (!auth_challenge) {
        logger.error("AuthenticateWithCloud_Begin failed [dna:%d]",
                     auth_challenge.error());
        if (auth_challenge.error() ==
            Ntag424::DNA_StatusCode::AUTHENTICATION_DELAY) {
          // Need to retry until successful
          return std::nullopt;
        }

        return Failed{.error = ErrorType::kNtagFailed,
                      .message = std::string(String::format(
                          "AuthenticateWithCloud_Begin failed [dna:%d]",
                          auth_challenge.error()).c_str())};
      }

      AuthenticateNewSessionRequestT request;
      request.token_id =
          std::make_unique<TagUid>(flatbuffers::span<uint8_t, 7>(tag_uid));
      request.ntag_challenge.assign(auth_challenge->begin(),
                                    auth_challenge->end());

      auto response =
          cloud_request
              .SendTerminalRequest<AuthenticateNewSessionRequestT,
                                   AuthenticateNewSessionResponseT>(
                  "authenticateNewSession", request);

      return AwaitAuthenticateNewSessionResponse{.response = response};
    }
    case StartSessionResult::Rejected: {
      // ---- REJECTED --------------------------------------------------------
      return Rejected{
          .message = start_session_response->result.AsRejected()->message};
    }
    default: {
      // ---- MALFORMED RESPONSE ----------------------------------------------
      return Failed{
          .error = ErrorType::kMalformedResponse,
          .message = std::string(String::format("Unknown StartSessionResult type %d",
                                    start_session_response->result.type).c_str())};
    }
  }
}

SessionCreationStateMachine::StateOpt OnAwaitAuthenticateNewSession(
    AwaitAuthenticateNewSessionResponse& state, CloudRequest& cloud_request,
    Ntag424& ntag_interface) {
  auto cloud_response = state.response.get();
  if (state::IsPending(*cloud_response)) {
    return std::nullopt;  // Stay in current state
  }

  auto auth_new_session_response =
      std::get_if<AuthenticateNewSessionResponseT>(cloud_response);
  if (!auth_new_session_response) {
    return Failed{.error = std::get<ErrorType>(*cloud_response),
                  .message = "Cloud request failed"};
  }

  auto cloud_challenge = auth_new_session_response->cloud_challenge;

  std::array<byte, 32> challenge_array;
  std::copy(cloud_challenge.begin(), cloud_challenge.end(),
            challenge_array.begin());

  auto encrypted_response =
      ntag_interface.AuthenticateWithCloud_Part2(challenge_array);

  if (!encrypted_response) {
    return Failed{
        .error = ErrorType::kNtagFailed,
        .message = std::string(String::format("AuthenticateWithCloud_Part2 failed [dna:%d]",
                                  encrypted_response.error()).c_str())};
  }

  CompleteAuthenticationRequestT request;
  request.session_id = auth_new_session_response->session_id;
  request.encrypted_ntag_response.assign(encrypted_response->begin(),
                                         encrypted_response->end());

  auto response =
      cloud_request
          .SendTerminalRequest<CompleteAuthenticationRequestT,
                               CompleteAuthenticationResponseT>(
              "completeAuthentication", request);

  return AwaitCompleteAuthenticationResponse{.response = response};
}

SessionCreationStateMachine::StateOpt OnAwaitCompleteAuthentication(
    AwaitCompleteAuthenticationResponse& state, Sessions& sessions) {
  auto cloud_response = state.response.get();
  if (state::IsPending(*cloud_response)) {
    return std::nullopt;  // Stay in current state
  }

  auto complete_auth_response =
      std::get_if<CompleteAuthenticationResponseT>(cloud_response);
  if (!complete_auth_response) {
    return Failed{.error = std::get<ErrorType>(*cloud_response),
                  .message = "Cloud request failed"};
  }

  switch (complete_auth_response->result.type) {
    case CompleteAuthenticationResult::TokenSession: {
      // ---- SESSION CREATED ------------------------------------------------
      auto token_session_data = complete_auth_response->result.AsTokenSession();

      if (!token_session_data) {
        logger.error("CompleteAuthenticationResult is missing TokenSession");
        return Failed{.error = ErrorType::kMalformedResponse,
                      .message = "Missing TokenSession"};
      }

      auto new_session = sessions.RegisterSession(*token_session_data);
      return Succeeded{.session = new_session};
    }
    case CompleteAuthenticationResult::Rejected: {
      // ---- REJECTED --------------------------------------------------------
      return Rejected{
          .message = complete_auth_response->result.AsRejected()->message};
    }
    default: {
      // ---- MALFORMED RESPONSE ----------------------------------------------
      logger.error(String::format("Unknown CompleteAuthenticationResult type %d",
                                  complete_auth_response->result.type));
      return Failed{.error = ErrorType::kMalformedResponse,
                    .message = "Unknown CompleteAuthenticationResult type"};
    }
  }
}

// ---- Loop dispatchers ------------------------------------------------------

StartSessionAction::StartSessionAction(
    std::array<uint8_t, 7> tag_uid, std::weak_ptr<CloudRequest> cloud_request,
    std::weak_ptr<Sessions> sessions)
    : tag_uid_(tag_uid),
      cloud_request_(cloud_request.lock()),
      sessions_(sessions.lock()),
      state_machine_(SessionCreationStateMachine::Create(
          std::in_place_type<Begin>)) {
  // TODO: Replace with proper assert macro that logs and crashes
  if (!cloud_request_ || !sessions_) {
    logger.error("FATAL: StartSessionAction created with null dependencies");
    delay(100);  // Let log flush
    System.reset();
  }

  RegisterStateHandlers();
}

void StartSessionAction::RegisterStateHandlers() {
  state_machine_->OnLoop<Begin>([this](auto& s) {
    return OnBegin(s, tag_uid_, *sessions_, *cloud_request_);
  });

  state_machine_->OnLoop<AwaitStartSessionResponse>([this](auto& s) {
    return OnAwaitStartSession(s, tag_uid_, *sessions_, *cloud_request_,
                               *ntag_interface_);
  });

  state_machine_->OnLoop<AwaitAuthenticateNewSessionResponse>([this](auto& s) {
    return OnAwaitAuthenticateNewSession(s, *cloud_request_, *ntag_interface_);
  });

  state_machine_->OnLoop<AwaitCompleteAuthenticationResponse>([this](auto& s) {
    return OnAwaitCompleteAuthentication(s, *sessions_);
  });
}

NtagAction::Continuation StartSessionAction::Loop(Ntag424& ntag_interface) {
  // Store ntag interface for state handlers to access
  ntag_interface_ = &ntag_interface;

  // Run state machine
  state_machine_->Loop();

  return IsComplete() ? Continuation::Done : Continuation::Continue;
}

bool StartSessionAction::IsComplete() {
  return state_machine_->Is<Succeeded>() ||
         state_machine_->Is<Rejected>() ||
         state_machine_->Is<Failed>();
}

void StartSessionAction::OnAbort(ErrorType error) {
  state_machine_->TransitionTo(
      Failed{.error = error, .message = "Ntag transaction aborted"});
}

}  // namespace oww::logic::action