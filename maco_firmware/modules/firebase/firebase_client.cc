// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Define log module before any includes that might transitively include pw_log
#define PW_LOG_MODULE_NAME "firebase"

#include "firebase/firebase_client.h"

#include <array>

#include "firebase_rpc/auth.pwpb.h"
#include "gateway/gateway_service.pwpb.h"
#include "gateway/gateway_service.rpc.pwpb.h"
#include "pw_log/log.h"
#include "pw_status/try.h"
#include "pw_stream/memory_stream.h"

namespace maco::firebase {

namespace {

// Endpoint paths for Firebase functions
constexpr const char* kTerminalCheckinEndpoint = "/api/terminalCheckin";
constexpr const char* kAuthenticateTagEndpoint = "/api/authenticateTag";
constexpr const char* kCompleteTagAuthEndpoint = "/api/completeTagAuth";

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

pw::async2::Coro<pw::Result<TerminalCheckinResponse>>
FirebaseClient::TerminalCheckin([[maybe_unused]] pw::async2::CoroContext& cx,
                                const TagUid& tag_uid) {
  if (terminal_checkin_call_.active()) {
    PW_LOG_WARN("TerminalCheckin called while previous call still in flight");
    co_return pw::Status::Unavailable();
  }

  // Serialize the request payload
  std::array<std::byte, kMaxPayloadSize> payload_buffer;
  maco::proto::firebase_rpc::pwpb::TerminalCheckinRequest::MemoryEncoder
      encoder(payload_buffer);

  auto status = encoder.WriteTokenIdMessage(
      [&tag_uid](maco::proto::pwpb::TagUid::StreamEncoder& uid_encoder) {
        return uid_encoder.WriteValue(tag_uid.value);
      });
  if (!status.ok()) {
    PW_LOG_ERROR("Failed to encode TerminalCheckinRequest: %s", status.str());
    co_return status;
  }

  // Build and send the request
  auto request = BuildForwardRequest(
      kTerminalCheckinEndpoint,
      pw::ConstByteSpan(payload_buffer.data(), encoder.size()));

  GatewayClient client(rpc_client_, channel_id_);
  terminal_checkin_call_ = client.Forward(
      request,
      [this](const ForwardResponseMsg& resp, pw::Status st) {
        if (!st.ok()) {
          PW_LOG_ERROR("TerminalCheckin RPC failed: %s", st.str());
          terminal_checkin_provider_.Resolve(st);
          return;
        }
        if (!resp.success) {
          PW_LOG_ERROR("TerminalCheckin returned error (http %u): %s",
                       static_cast<unsigned>(resp.http_status),
                       resp.error.c_str());
          terminal_checkin_provider_.Resolve(pw::Status::Internal());
          return;
        }

        TerminalCheckinResponse result;
        auto decode_status = DecodeResponse<
            TerminalCheckinResponse,
            maco::proto::firebase_rpc::pwpb::TerminalCheckinResponse::
                StreamDecoder>(resp.payload, result);
        if (!decode_status.ok()) {
          PW_LOG_ERROR("Failed to decode TerminalCheckinResponse: %s",
                       decode_status.str());
          terminal_checkin_provider_.Resolve(pw::Status::DataLoss());
          return;
        }

        terminal_checkin_provider_.Resolve(std::move(result));
      },
      [this](pw::Status st) {
        PW_LOG_ERROR("TerminalCheckin RPC error: %s", st.str());
        terminal_checkin_provider_.Resolve(st);
      });

  co_return co_await terminal_checkin_provider_.Get();
}

pw::async2::Coro<pw::Result<AuthenticateTagResponse>>
FirebaseClient::AuthenticateTag([[maybe_unused]] pw::async2::CoroContext& cx,
                                const TagUid& tag_uid,
                                Key key_slot,
                                pw::ConstByteSpan ntag_challenge) {
  if (authenticate_tag_call_.active()) {
    PW_LOG_WARN("AuthenticateTag called while previous call still in flight");
    co_return pw::Status::Unavailable();
  }

  // Serialize the request payload
  std::array<std::byte, kMaxPayloadSize> payload_buffer;
  maco::proto::firebase_rpc::pwpb::AuthenticateTagRequest::MemoryEncoder
      encoder(payload_buffer);

  auto status = encoder.WriteTagIdMessage(
      [&tag_uid](maco::proto::pwpb::TagUid::StreamEncoder& uid_encoder) {
        return uid_encoder.WriteValue(tag_uid.value);
      });
  if (!status.ok()) {
    PW_LOG_ERROR("Failed to encode AuthenticateTagRequest tag_id: %s",
                 status.str());
    co_return status;
  }

  status = encoder.WriteKeySlot(key_slot);
  if (!status.ok()) {
    PW_LOG_ERROR("Failed to encode AuthenticateTagRequest key_slot: %s",
                 status.str());
    co_return status;
  }

  status = encoder.WriteNtagChallenge(ntag_challenge);
  if (!status.ok()) {
    PW_LOG_ERROR("Failed to encode AuthenticateTagRequest ntag_challenge: %s",
                 status.str());
    co_return status;
  }

  // Build and send the request
  auto request = BuildForwardRequest(
      kAuthenticateTagEndpoint,
      pw::ConstByteSpan(payload_buffer.data(), encoder.size()));

  GatewayClient client(rpc_client_, channel_id_);
  authenticate_tag_call_ = client.Forward(
      request,
      [this](const ForwardResponseMsg& resp, pw::Status st) {
        if (!st.ok()) {
          PW_LOG_ERROR("AuthenticateTag RPC failed: %s", st.str());
          authenticate_tag_provider_.Resolve(st);
          return;
        }
        if (!resp.success) {
          PW_LOG_ERROR("AuthenticateTag returned error (http %u): %s",
                       static_cast<unsigned>(resp.http_status),
                       resp.error.c_str());
          authenticate_tag_provider_.Resolve(pw::Status::Internal());
          return;
        }

        AuthenticateTagResponse result;
        auto decode_status = DecodeResponse<
            AuthenticateTagResponse,
            maco::proto::firebase_rpc::pwpb::AuthenticateTagResponse::
                StreamDecoder>(resp.payload, result);
        if (!decode_status.ok()) {
          PW_LOG_ERROR("Failed to decode AuthenticateTagResponse: %s",
                       decode_status.str());
          authenticate_tag_provider_.Resolve(pw::Status::DataLoss());
          return;
        }

        authenticate_tag_provider_.Resolve(std::move(result));
      },
      [this](pw::Status st) {
        PW_LOG_ERROR("AuthenticateTag RPC error: %s", st.str());
        authenticate_tag_provider_.Resolve(st);
      });

  co_return co_await authenticate_tag_provider_.Get();
}

pw::async2::Coro<pw::Result<CompleteTagAuthResponse>>
FirebaseClient::CompleteTagAuth([[maybe_unused]] pw::async2::CoroContext& cx,
                                const FirebaseId& auth_id,
                                pw::ConstByteSpan encrypted_tag_response) {
  if (complete_tag_auth_call_.active()) {
    PW_LOG_WARN("CompleteTagAuth called while previous call still in flight");
    co_return pw::Status::Unavailable();
  }

  // Serialize the request payload
  std::array<std::byte, kMaxPayloadSize> payload_buffer;
  maco::proto::firebase_rpc::pwpb::CompleteTagAuthRequest::MemoryEncoder
      encoder(payload_buffer);

  auto status = encoder.WriteAuthIdMessage(
      [&auth_id](maco::proto::pwpb::FirebaseId::StreamEncoder& id_encoder) {
        return id_encoder.WriteValue(auth_id.value);
      });
  if (!status.ok()) {
    PW_LOG_ERROR("Failed to encode CompleteTagAuthRequest auth_id: %s",
                 status.str());
    co_return status;
  }

  status = encoder.WriteEncryptedTagResponse(encrypted_tag_response);
  if (!status.ok()) {
    PW_LOG_ERROR(
        "Failed to encode CompleteTagAuthRequest encrypted_tag_response: %s",
        status.str());
    co_return status;
  }

  // Build and send the request
  auto request = BuildForwardRequest(
      kCompleteTagAuthEndpoint,
      pw::ConstByteSpan(payload_buffer.data(), encoder.size()));

  GatewayClient client(rpc_client_, channel_id_);
  complete_tag_auth_call_ = client.Forward(
      request,
      [this](const ForwardResponseMsg& resp, pw::Status st) {
        if (!st.ok()) {
          PW_LOG_ERROR("CompleteTagAuth RPC failed: %s", st.str());
          complete_tag_auth_provider_.Resolve(st);
          return;
        }
        if (!resp.success) {
          PW_LOG_ERROR("CompleteTagAuth returned error (http %u): %s",
                       static_cast<unsigned>(resp.http_status),
                       resp.error.c_str());
          complete_tag_auth_provider_.Resolve(pw::Status::Internal());
          return;
        }

        CompleteTagAuthResponse result;
        auto decode_status = DecodeResponse<
            CompleteTagAuthResponse,
            maco::proto::firebase_rpc::pwpb::CompleteTagAuthResponse::
                StreamDecoder>(resp.payload, result);
        if (!decode_status.ok()) {
          PW_LOG_ERROR("Failed to decode CompleteTagAuthResponse: %s",
                       decode_status.str());
          complete_tag_auth_provider_.Resolve(pw::Status::DataLoss());
          return;
        }

        complete_tag_auth_provider_.Resolve(std::move(result));
      },
      [this](pw::Status st) {
        PW_LOG_ERROR("CompleteTagAuth RPC error: %s", st.str());
        complete_tag_auth_provider_.Resolve(st);
      });

  co_return co_await complete_tag_auth_provider_.Get();
}

}  // namespace maco::firebase
