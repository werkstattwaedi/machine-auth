// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "firebase/firebase_client.h"

#include <array>

#include "firebase_rpc/session.pwpb.h"
#include "gateway/gateway_service.pwpb.h"
#include "gateway/gateway_service.rpc.pwpb.h"
#include "pw_status/try.h"
#include "pw_stream/memory_stream.h"

#define PW_LOG_MODULE_NAME "firebase"
#include "pw_log/log.h"

namespace maco::firebase {

namespace {

// Endpoint paths for Firebase functions
constexpr const char* kStartSessionEndpoint = "/api/startSession";
constexpr const char* kAuthenticateNewSessionEndpoint =
    "/api/authenticateNewSession";
constexpr const char* kCompleteAuthenticationEndpoint =
    "/api/completeAuthentication";

// Maximum payload size for serialization
constexpr size_t kMaxPayloadSize = 512;

// Type aliases for gateway service
using GatewayClient = maco::gateway::pw_rpc::pwpb::GatewayService::Client;
using ForwardResponseMsg = maco::gateway::pwpb::ForwardResponse::Message;
using ForwardRequestMsg = maco::gateway::pwpb::ForwardRequest::Message;

}  // namespace

FirebaseClient::FirebaseClient(pw::rpc::Client& rpc_client, uint32_t channel_id)
    : rpc_client_(rpc_client), channel_id_(channel_id) {}

StartSessionFuture FirebaseClient::StartSession(const TagUid& tag_uid) {
  if (start_session_call_.active()) {
    PW_LOG_WARN("StartSession called while previous call still in flight");
    return StartSessionFuture::Resolved(pw::Status::Unavailable());
  }

  // Serialize the inner request payload
  std::array<std::byte, kMaxPayloadSize> payload_buffer;
  maco::proto::firebase_rpc::pwpb::StartSessionRequest::MemoryEncoder encoder(
      payload_buffer
  );

  auto encode_status = [&]() -> pw::Status {
    PW_TRY(encoder.WriteTokenIdMessage(
        [&tag_uid](maco::proto::pwpb::TagUid::StreamEncoder& uid_encoder) {
          return uid_encoder.WriteValue(tag_uid.value);
        }
    ));
    return pw::OkStatus();
  }();
  if (!encode_status.ok()) {
    PW_LOG_ERROR("Failed to encode StartSessionRequest");
    return StartSessionFuture::Resolved(pw::Status::Internal());
  }

  // Build ForwardRequest with inline fields
  ForwardRequestMsg request;
  request.endpoint = kStartSessionEndpoint;
  request.payload.resize(encoder.size());
  std::copy_n(payload_buffer.begin(), encoder.size(), request.payload.begin());

  // Make the async RPC call
  GatewayClient client(rpc_client_, channel_id_);
  start_session_call_ = client.Forward(
      request,
      [this](const ForwardResponseMsg& resp, pw::Status st) {
        if (!st.ok()) {
          PW_LOG_ERROR(
              "StartSession RPC failed: %d", static_cast<int>(st.code())
          );
          start_session_provider_.Resolve(st);
          return;
        }
        if (!resp.success) {
          PW_LOG_ERROR(
              "StartSession returned error (http %u): %s",
              static_cast<unsigned>(resp.http_status),
              resp.error.c_str()
          );
          start_session_provider_.Resolve(pw::Status::Internal());
          return;
        }

        // Decode the response payload
        StartSessionResponse result;
        pw::stream::MemoryReader reader(resp.payload);
        maco::proto::firebase_rpc::pwpb::StartSessionResponse::StreamDecoder
            decoder(reader);
        auto decode_status = decoder.Read(result);
        if (!decode_status.ok()) {
          PW_LOG_ERROR("Failed to decode StartSessionResponse");
          start_session_provider_.Resolve(pw::Status::DataLoss());
          return;
        }

        start_session_provider_.Resolve(std::move(result));
      },
      [this](pw::Status st) {
        PW_LOG_ERROR("StartSession RPC error: %d", static_cast<int>(st.code()));
        start_session_provider_.Resolve(st);
      }
  );

  return start_session_provider_.Get();
}

AuthenticateNewSessionFuture FirebaseClient::AuthenticateNewSession(
    const TagUid& tag_uid, pw::ConstByteSpan ntag_challenge
) {
  if (auth_new_session_call_.active()) {
    PW_LOG_WARN(
        "AuthenticateNewSession called while previous call still in flight"
    );
    return AuthenticateNewSessionFuture::Resolved(pw::Status::Unavailable());
  }

  // Serialize the inner request payload
  std::array<std::byte, kMaxPayloadSize> payload_buffer;
  maco::proto::firebase_rpc::pwpb::AuthenticateNewSessionRequest::MemoryEncoder
      encoder(payload_buffer);

  auto encode_status = [&]() -> pw::Status {
    PW_TRY(encoder.WriteTokenIdMessage(
        [&tag_uid](maco::proto::pwpb::TagUid::StreamEncoder& uid_encoder) {
          return uid_encoder.WriteValue(tag_uid.value);
        }
    ));
    PW_TRY(encoder.WriteNtagChallenge(ntag_challenge));
    return pw::OkStatus();
  }();
  if (!encode_status.ok()) {
    PW_LOG_ERROR("Failed to encode AuthenticateNewSessionRequest");
    return AuthenticateNewSessionFuture::Resolved(pw::Status::Internal());
  }

  // Build ForwardRequest with inline fields
  ForwardRequestMsg request;
  request.endpoint = kAuthenticateNewSessionEndpoint;
  request.payload.resize(encoder.size());
  std::copy_n(payload_buffer.begin(), encoder.size(), request.payload.begin());

  // Make the async RPC call
  GatewayClient client(rpc_client_, channel_id_);
  auth_new_session_call_ = client.Forward(
      request,
      [this](const ForwardResponseMsg& resp, pw::Status st) {
        if (!st.ok()) {
          PW_LOG_ERROR(
              "AuthenticateNewSession RPC failed: %d",
              static_cast<int>(st.code())
          );
          auth_new_session_provider_.Resolve(st);
          return;
        }
        if (!resp.success) {
          PW_LOG_ERROR(
              "AuthenticateNewSession returned error (http %u): %s",
              static_cast<unsigned>(resp.http_status),
              resp.error.c_str()
          );
          auth_new_session_provider_.Resolve(pw::Status::Internal());
          return;
        }

        // Decode the response payload
        AuthenticateNewSessionResponse result;
        pw::stream::MemoryReader reader(resp.payload);
        maco::proto::firebase_rpc::pwpb::AuthenticateNewSessionResponse::
            StreamDecoder decoder(reader);
        auto decode_status = decoder.Read(result);
        if (!decode_status.ok()) {
          PW_LOG_ERROR("Failed to decode AuthenticateNewSessionResponse");
          auth_new_session_provider_.Resolve(pw::Status::DataLoss());
          return;
        }

        auth_new_session_provider_.Resolve(std::move(result));
      },
      [this](pw::Status st) {
        PW_LOG_ERROR(
            "AuthenticateNewSession RPC error: %d", static_cast<int>(st.code())
        );
        auth_new_session_provider_.Resolve(st);
      }
  );

  return auth_new_session_provider_.Get();
}

CompleteAuthenticationFuture FirebaseClient::CompleteAuthentication(
    const FirebaseId& session_id, pw::ConstByteSpan encrypted_ntag_response
) {
  if (complete_auth_call_.active()) {
    PW_LOG_WARN(
        "CompleteAuthentication called while previous call still in flight"
    );
    return CompleteAuthenticationFuture::Resolved(pw::Status::Unavailable());
  }

  // Serialize the inner request payload
  std::array<std::byte, kMaxPayloadSize> payload_buffer;
  maco::proto::firebase_rpc::pwpb::CompleteAuthenticationRequest::MemoryEncoder
      encoder(payload_buffer);

  auto encode_status = [&]() -> pw::Status {
    PW_TRY(encoder.WriteSessionIdMessage(
        [&session_id](maco::proto::pwpb::FirebaseId::StreamEncoder& id_encoder) {
          return id_encoder.WriteValue(session_id.value);
        }
    ));
    PW_TRY(encoder.WriteEncryptedNtagResponse(encrypted_ntag_response));
    return pw::OkStatus();
  }();
  if (!encode_status.ok()) {
    PW_LOG_ERROR("Failed to encode CompleteAuthenticationRequest");
    return CompleteAuthenticationFuture::Resolved(pw::Status::Internal());
  }

  // Build ForwardRequest with inline fields
  ForwardRequestMsg request;
  request.endpoint = kCompleteAuthenticationEndpoint;
  request.payload.resize(encoder.size());
  std::copy_n(payload_buffer.begin(), encoder.size(), request.payload.begin());

  // Make the async RPC call
  GatewayClient client(rpc_client_, channel_id_);
  complete_auth_call_ = client.Forward(
      request,
      [this](const ForwardResponseMsg& resp, pw::Status st) {
        if (!st.ok()) {
          PW_LOG_ERROR(
              "CompleteAuthentication RPC failed: %d",
              static_cast<int>(st.code())
          );
          complete_auth_provider_.Resolve(st);
          return;
        }
        if (!resp.success) {
          PW_LOG_ERROR(
              "CompleteAuthentication returned error (http %u): %s",
              static_cast<unsigned>(resp.http_status),
              resp.error.c_str()
          );
          complete_auth_provider_.Resolve(pw::Status::Internal());
          return;
        }

        // Decode the response payload
        CompleteAuthenticationResponse result;
        pw::stream::MemoryReader reader(resp.payload);
        maco::proto::firebase_rpc::pwpb::CompleteAuthenticationResponse::
            StreamDecoder decoder(reader);
        auto decode_status = decoder.Read(result);
        if (!decode_status.ok()) {
          PW_LOG_ERROR("Failed to decode CompleteAuthenticationResponse");
          complete_auth_provider_.Resolve(pw::Status::DataLoss());
          return;
        }

        complete_auth_provider_.Resolve(std::move(result));
      },
      [this](pw::Status st) {
        PW_LOG_ERROR(
            "CompleteAuthentication RPC error: %d", static_cast<int>(st.code())
        );
        complete_auth_provider_.Resolve(st);
      }
  );

  return complete_auth_provider_.Get();
}

}  // namespace maco::firebase
