#include "start_session.h"

#include <type_traits>

#include "common/byte_array.h"
#include "config.h"
#include "logic/application.h"
#include "logic/configuration.h"

namespace oww::logic::action {

Logger logger("app.logic.action.start_session");

using namespace oww::logic::action::start_session;
using namespace oww::logic::session;
using namespace config::tag;
using namespace fbs;
using namespace oww::nfc;
using oww::logic::CloudRequest;

tl::expected<std::shared_ptr<InternalState>, ErrorType> OnBegin(
    std::array<uint8_t, 7> tag_uid, Sessions& sessions,
    CloudRequest& cloud_request) {
  auto existing_session = sessions.GetSessionForToken(tag_uid);

  if (existing_session) {
    return std::make_shared<InternalState>(
        Succeeded{.session = existing_session});
  }

  StartSessionRequestT request;
  request.token_id =
      std::make_unique<TagUid>(flatbuffers::span<uint8_t, 7>(tag_uid));

  auto response =
      cloud_request
          .SendTerminalRequest<StartSessionRequestT, StartSessionResponseT>(
              "startSession", request);

  return std::make_shared<InternalState>(
      AwaitStartSessionResponse{.response = response});
}

tl::expected<std::shared_ptr<InternalState>, ErrorType> OnStartSessionResponse(
    AwaitStartSessionResponse& response_holder, std::array<uint8_t, 7> tag_uid,
    Sessions& sessions, CloudRequest& cloud_request, Ntag424& ntag_interface) {
  auto cloud_response = response_holder.response.get();
  if (IsPending(*cloud_response)) {
    return nullptr;
  }

  auto start_session_response =
      std::get_if<StartSessionResponseT>(cloud_response);
  if (!start_session_response) {
    return tl::unexpected(std::get<ErrorType>(*cloud_response));
  }

  switch (start_session_response->result.type) {
    case StartSessionResult::TokenSession: {
      // ---- EXISTING SESSION ------------------------------------------------
      auto token_session_data = start_session_response->result.AsTokenSession();
      if (!token_session_data) {
        return tl::unexpected(ErrorType::kMalformedResponse);
      }

      auto existing_session = sessions.RegisterSession(*token_session_data);
      return std::make_shared<InternalState>(
          Succeeded{.session = existing_session});
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
          return nullptr;
        }

        logger.error(String::format("AuthenticateWithCloud_Begin failed [dna:%d]",
                                    auth_challenge.error()));
        return tl::unexpected(ErrorType::kNtagFailed);
      }

      AuthenticateNewSessionRequestT request;
      request.token_id =
          std::make_unique<TagUid>(flatbuffers::span<uint8_t, 7>(tag_uid));
      request.ntag_challenge.assign(auth_challenge->begin(),
                                    auth_challenge->end());

      auto response =
          cloud_request.SendTerminalRequest<AuthenticateNewSessionRequestT,
                                            AuthenticateNewSessionResponseT>(
              "authenticateNewSession", request);

      return std::make_shared<InternalState>(
          AwaitAuthenticateNewSessionResponse{.response = response});
    }
    case StartSessionResult::Rejected: {
      // ---- REJECTED --------------------------------------------------------

      return std::make_shared<InternalState>(Rejected{
          .message = start_session_response->result.AsRejected()->message});
    }
    default: {
      // ---- MALFORMED RESPONSE ----------------------------------------------
      logger.error(String::format("Unknown StartSessionResult type %d",
                                  start_session_response->result.type));
      return tl::unexpected(ErrorType::kMalformedResponse);
    }
  }
}

tl::expected<std::shared_ptr<InternalState>, ErrorType>
OnAuthenticateNewSessionResponse(
    AwaitAuthenticateNewSessionResponse& response_holder,

    CloudRequest& cloud_request, Ntag424& ntag_interface) {
  auto cloud_response = response_holder.response.get();
  if (IsPending(*cloud_response)) {
    return nullptr;
  }

  auto auth_new_session_response =
      std::get_if<AuthenticateNewSessionResponseT>(cloud_response);
  if (!auth_new_session_response) {
    return tl::unexpected(std::get<ErrorType>(*cloud_response));
  }

  auto cloud_challenge = auth_new_session_response->cloud_challenge;

  std::array<byte, 32> challenge_array;
  std::copy(cloud_challenge.begin(), cloud_challenge.end(),
            challenge_array.begin());

  auto encrypted_response =
      ntag_interface.AuthenticateWithCloud_Part2(challenge_array);

  if (!encrypted_response) {
    logger.error(String::format("AuthenticateWithCloud_Part2 failed [dna:%d]",
                                encrypted_response.error()));
    return tl::unexpected(ErrorType::kNtagFailed);
  }

  CompleteAuthenticationRequestT request;
  request.session_id = auth_new_session_response->session_id;
  request.encrypted_ntag_response.assign(encrypted_response->begin(),
                                         encrypted_response->end());

  auto response =
      cloud_request.SendTerminalRequest<CompleteAuthenticationRequestT,
                                        CompleteAuthenticationResponseT>(
          "completeAuthentication", request);

  return std::make_shared<InternalState>(
      AwaitCompleteAuthenticationResponse{.response = response});
}

tl::expected<std::shared_ptr<InternalState>, ErrorType>
OnCompleteAuthenticationResponse(
    AwaitCompleteAuthenticationResponse& response_holder, Sessions& sessions) {
  auto cloud_response = response_holder.response.get();
  if (IsPending(*cloud_response)) {
    return nullptr;
  }

  auto complete_auth_response =
      std::get_if<CompleteAuthenticationResponseT>(cloud_response);
  if (!complete_auth_response) {
    return tl::unexpected(std::get<ErrorType>(*cloud_response));
  }

  switch (complete_auth_response->result.type) {
    case CompleteAuthenticationResult::TokenSession: {
      // ---- SESSION CREATED ------------------------------------------------
      auto token_session_data = complete_auth_response->result.AsTokenSession();

      if (!token_session_data) {
        logger.error("CompleteAuthenticationResult is missing TokenSession");
        return tl::unexpected(ErrorType::kMalformedResponse);
      }

      auto new_session = sessions.RegisterSession(*token_session_data);
      return std::make_shared<InternalState>(Succeeded{.session = new_session});
    }
    case CompleteAuthenticationResult::Rejected: {
      // ---- REJECTED --------------------------------------------------------

      return std::make_shared<InternalState>(Rejected{
          .message = complete_auth_response->result.AsRejected()->message});
    }
    default: {
      // ---- MALFORMED RESPONSE ----------------------------------------------
      logger.error(String::format("Unknown CompleteAuthenticationResult type %d",
                                  complete_auth_response->result.type));
      return tl::unexpected(ErrorType::kMalformedResponse);
    }
  }
}

// ---- Loop dispatchers ------------------------------------------------------

StartSessionAction::StartSessionAction(
    std::array<uint8_t, 7> tag_uid, std::weak_ptr<CloudRequest> cloud_request,
    std::weak_ptr<Sessions> sessions)
    : tag_uid_(tag_uid),
      cloud_request_(cloud_request),
      sessions_(sessions),
      state_(std::make_shared<InternalState>(Begin{})) {}

NtagAction::Continuation StartSessionAction::Loop(Ntag424& ntag_interface) {
  auto sessions = sessions_.lock();
  auto cloud_request = cloud_request_.lock();

  tl::expected<std::shared_ptr<InternalState>, ErrorType> result;

  if (std::get_if<Begin>(state_.get())) {
    result = OnBegin(tag_uid_, *sessions, *cloud_request);
  } else if (auto nested =
                 std::get_if<AwaitStartSessionResponse>(state_.get())) {
    result = OnStartSessionResponse(*nested, tag_uid_, *sessions,
                                    *cloud_request, ntag_interface);
  } else if (auto nested = std::get_if<AwaitAuthenticateNewSessionResponse>(
                 state_.get())) {
    result = OnAuthenticateNewSessionResponse(*nested, *cloud_request,
                                              ntag_interface);
  } else if (auto nested = std::get_if<AwaitCompleteAuthenticationResponse>(
                 state_.get())) {
    result = OnCompleteAuthenticationResponse(*nested, *sessions);
  }

  if (!result) {
    state_ = std::make_shared<InternalState>(Failed{.error = result.error()});
  } else if (auto new_state = (*result)) {
    state_ = new_state;
  }

  return IsComplete() ? Continuation::Done : Continuation::Continue;
}

bool StartSessionAction::IsComplete() {
  return std::visit(
      [](auto&& arg) {
        using T = std::decay_t<decltype(arg)>;
        return std::is_same_v<T, Succeeded> || std::is_same_v<T, Rejected> ||
               std::is_same_v<T, Failed>;
      },
      *state_);
}

void StartSessionAction::OnAbort(ErrorType error) {
  state_ = std::make_shared<InternalState>(
      Failed{.error = error, .message = "Ntag transaction aborted"});
}

}  // namespace oww::logic::action