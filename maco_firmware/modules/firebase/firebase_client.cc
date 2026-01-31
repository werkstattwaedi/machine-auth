// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Define log module before any includes that might transitively include pw_log
#define PW_LOG_MODULE_NAME "firebase"

#include "firebase/firebase_client.h"

#include <array>

#include "firebase_rpc/session.pwpb.h"
#include "gateway/gateway_service.pwpb.h"
#include "gateway/gateway_service.rpc.pwpb.h"
#include "pw_log/log.h"
#include "pw_status/try.h"
#include "pw_stream/memory_stream.h"

namespace maco::firebase {

namespace {

// Endpoint paths for Firebase functions
constexpr const char* kStartSessionEndpoint = "/api/startSession";
constexpr const char* kAuthenticateNewSessionEndpoint =
    "/api/authenticateNewSession";
constexpr const char* kCompleteAuthenticationEndpoint =
    "/api/completeAuthentication";

// Maximum payload size for serialization.
// Must be large enough for the largest request message.
constexpr size_t kMaxPayloadSize = 512;
static_assert(kMaxPayloadSize >= 256,
              "Payload buffer must fit encoded Firebase requests");

// Type aliases for gateway service
using GatewayClient = maco::gateway::pw_rpc::pwpb::GatewayService::Client;
using ForwardResponseMsg = maco::gateway::pwpb::ForwardResponse::Message;
using ForwardRequestMsg = maco::gateway::pwpb::ForwardRequest::Message;

/// Build a ForwardRequest from endpoint and payload.
ForwardRequestMsg BuildForwardRequest(const char* endpoint,
                                      pw::ConstByteSpan payload) {
  ForwardRequestMsg request;
  request.endpoint = endpoint;
  request.payload.resize(payload.size());
  std::copy(payload.begin(), payload.end(), request.payload.begin());
  return request;
}

/// Decode a response payload into a message type.
/// @return OkStatus on success, DataLoss on decode failure
template <typename ResponseMsg, typename DecoderType>
pw::Status DecodeResponse(pw::ConstByteSpan payload, ResponseMsg& result) {
  pw::stream::MemoryReader reader(payload);
  DecoderType decoder(reader);
  return decoder.Read(result);
}

}  // namespace

FirebaseClient::FirebaseClient(pw::rpc::Client& rpc_client,
                               uint32_t channel_id)
    : rpc_client_(rpc_client), channel_id_(channel_id) {}

pw::async2::Coro<pw::Result<StartSessionResponse>> FirebaseClient::StartSession(
    [[maybe_unused]] pw::async2::CoroContext& cx, const TagUid& tag_uid) {
  if (start_session_call_.active()) {
    PW_LOG_WARN("StartSession called while previous call still in flight");
    co_return pw::Status::Unavailable();
  }

  // Serialize the request payload
  std::array<std::byte, kMaxPayloadSize> payload_buffer;
  maco::proto::firebase_rpc::pwpb::StartSessionRequest::MemoryEncoder encoder(
      payload_buffer);

  auto status = encoder.WriteTokenIdMessage(
      [&tag_uid](maco::proto::pwpb::TagUid::StreamEncoder& uid_encoder) {
        return uid_encoder.WriteValue(tag_uid.value);
      });
  if (!status.ok()) {
    PW_LOG_ERROR("Failed to encode StartSessionRequest: %s", status.str());
    co_return status;
  }

  // Build and send the request
  auto request = BuildForwardRequest(
      kStartSessionEndpoint,
      pw::ConstByteSpan(payload_buffer.data(), encoder.size()));

  GatewayClient client(rpc_client_, channel_id_);
  start_session_call_ = client.Forward(
      request,
      [this](const ForwardResponseMsg& resp, pw::Status st) {
        if (!st.ok()) {
          PW_LOG_ERROR("StartSession RPC failed: %s", st.str());
          start_session_provider_.Resolve(st);
          return;
        }
        if (!resp.success) {
          PW_LOG_ERROR("StartSession returned error (http %u): %s",
                       static_cast<unsigned>(resp.http_status),
                       resp.error.c_str());
          start_session_provider_.Resolve(pw::Status::Internal());
          return;
        }

        StartSessionResponse result;
        auto decode_status = DecodeResponse<
            StartSessionResponse,
            maco::proto::firebase_rpc::pwpb::StartSessionResponse::
                StreamDecoder>(resp.payload, result);
        if (!decode_status.ok()) {
          PW_LOG_ERROR("Failed to decode StartSessionResponse: %s",
                       decode_status.str());
          start_session_provider_.Resolve(pw::Status::DataLoss());
          return;
        }

        start_session_provider_.Resolve(std::move(result));
      },
      [this](pw::Status st) {
        PW_LOG_ERROR("StartSession RPC error: %s", st.str());
        start_session_provider_.Resolve(st);
      });

  co_return co_await start_session_provider_.Get();
}

pw::async2::Coro<pw::Result<AuthenticateNewSessionResponse>>
FirebaseClient::AuthenticateNewSession(
    [[maybe_unused]] pw::async2::CoroContext& cx,
    const TagUid& tag_uid,
    pw::ConstByteSpan ntag_challenge) {
  if (auth_new_session_call_.active()) {
    PW_LOG_WARN(
        "AuthenticateNewSession called while previous call still in flight");
    co_return pw::Status::Unavailable();
  }

  // Serialize the request payload
  std::array<std::byte, kMaxPayloadSize> payload_buffer;
  maco::proto::firebase_rpc::pwpb::AuthenticateNewSessionRequest::MemoryEncoder
      encoder(payload_buffer);

  auto status = encoder.WriteTokenIdMessage(
      [&tag_uid](maco::proto::pwpb::TagUid::StreamEncoder& uid_encoder) {
        return uid_encoder.WriteValue(tag_uid.value);
      });
  if (!status.ok()) {
    PW_LOG_ERROR("Failed to encode AuthenticateNewSessionRequest: %s",
                 status.str());
    co_return status;
  }
  status = encoder.WriteNtagChallenge(ntag_challenge);
  if (!status.ok()) {
    PW_LOG_ERROR("Failed to encode ntag_challenge: %s", status.str());
    co_return status;
  }

  // Build and send the request
  auto request = BuildForwardRequest(
      kAuthenticateNewSessionEndpoint,
      pw::ConstByteSpan(payload_buffer.data(), encoder.size()));

  GatewayClient client(rpc_client_, channel_id_);
  auth_new_session_call_ = client.Forward(
      request,
      [this](const ForwardResponseMsg& resp, pw::Status st) {
        if (!st.ok()) {
          PW_LOG_ERROR("AuthenticateNewSession RPC failed: %s", st.str());
          auth_new_session_provider_.Resolve(st);
          return;
        }
        if (!resp.success) {
          PW_LOG_ERROR("AuthenticateNewSession returned error (http %u): %s",
                       static_cast<unsigned>(resp.http_status),
                       resp.error.c_str());
          auth_new_session_provider_.Resolve(pw::Status::Internal());
          return;
        }

        AuthenticateNewSessionResponse result;
        auto decode_status = DecodeResponse<
            AuthenticateNewSessionResponse,
            maco::proto::firebase_rpc::pwpb::AuthenticateNewSessionResponse::
                StreamDecoder>(resp.payload, result);
        if (!decode_status.ok()) {
          PW_LOG_ERROR("Failed to decode AuthenticateNewSessionResponse: %s",
                       decode_status.str());
          auth_new_session_provider_.Resolve(pw::Status::DataLoss());
          return;
        }

        auth_new_session_provider_.Resolve(std::move(result));
      },
      [this](pw::Status st) {
        PW_LOG_ERROR("AuthenticateNewSession RPC error: %s", st.str());
        auth_new_session_provider_.Resolve(st);
      });

  co_return co_await auth_new_session_provider_.Get();
}

pw::async2::Coro<pw::Result<CompleteAuthenticationResponse>>
FirebaseClient::CompleteAuthentication(
    [[maybe_unused]] pw::async2::CoroContext& cx,
    const FirebaseId& session_id,
    pw::ConstByteSpan encrypted_ntag_response) {
  if (complete_auth_call_.active()) {
    PW_LOG_WARN(
        "CompleteAuthentication called while previous call still in flight");
    co_return pw::Status::Unavailable();
  }

  // Serialize the request payload
  std::array<std::byte, kMaxPayloadSize> payload_buffer;
  maco::proto::firebase_rpc::pwpb::CompleteAuthenticationRequest::MemoryEncoder
      encoder(payload_buffer);

  auto status = encoder.WriteSessionIdMessage(
      [&session_id](maco::proto::pwpb::FirebaseId::StreamEncoder& id_encoder) {
        return id_encoder.WriteValue(session_id.value);
      });
  if (!status.ok()) {
    PW_LOG_ERROR("Failed to encode CompleteAuthenticationRequest: %s",
                 status.str());
    co_return status;
  }
  status = encoder.WriteEncryptedNtagResponse(encrypted_ntag_response);
  if (!status.ok()) {
    PW_LOG_ERROR("Failed to encode encrypted_ntag_response: %s", status.str());
    co_return status;
  }

  // Build and send the request
  auto request = BuildForwardRequest(
      kCompleteAuthenticationEndpoint,
      pw::ConstByteSpan(payload_buffer.data(), encoder.size()));

  GatewayClient client(rpc_client_, channel_id_);
  complete_auth_call_ = client.Forward(
      request,
      [this](const ForwardResponseMsg& resp, pw::Status st) {
        if (!st.ok()) {
          PW_LOG_ERROR("CompleteAuthentication RPC failed: %s", st.str());
          complete_auth_provider_.Resolve(st);
          return;
        }
        if (!resp.success) {
          PW_LOG_ERROR("CompleteAuthentication returned error (http %u): %s",
                       static_cast<unsigned>(resp.http_status),
                       resp.error.c_str());
          complete_auth_provider_.Resolve(pw::Status::Internal());
          return;
        }

        CompleteAuthenticationResponse result;
        auto decode_status = DecodeResponse<
            CompleteAuthenticationResponse,
            maco::proto::firebase_rpc::pwpb::CompleteAuthenticationResponse::
                StreamDecoder>(resp.payload, result);
        if (!decode_status.ok()) {
          PW_LOG_ERROR("Failed to decode CompleteAuthenticationResponse: %s",
                       decode_status.str());
          complete_auth_provider_.Resolve(pw::Status::DataLoss());
          return;
        }

        complete_auth_provider_.Resolve(std::move(result));
      },
      [this](pw::Status st) {
        PW_LOG_ERROR("CompleteAuthentication RPC error: %s", st.str());
        complete_auth_provider_.Resolve(st);
      });

  co_return co_await complete_auth_provider_.Get();
}

}  // namespace maco::firebase
