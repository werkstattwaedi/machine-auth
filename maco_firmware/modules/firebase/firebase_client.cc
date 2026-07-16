// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Define log module before any includes that might transitively include pw_log
#define PW_LOG_MODULE_NAME "firebase"

#include "firebase/firebase_client.h"

#include <array>
#include <chrono>
#include <cstring>

#include "common.pb.h"
#include "firebase_rpc/auth.pb.h"
#include "gateway/gateway_service.pb.h"
#include "gateway/gateway_service.rpc.pb.h"
#include "async_util/value_or_timeout.h"
#include "pb_decode.h"
#include "pb_encode.h"
#include "pw_async2/system_time_provider.h"
#include "pw_chrono/system_clock.h"
#include "pw_log/log.h"
#include "pw_status/try.h"

namespace maco::firebase {

namespace {

// Endpoint paths for Firebase functions
constexpr const char* kTerminalCheckinEndpoint = "/api/terminalCheckin";
constexpr const char* kAuthenticateTagEndpoint = "/api/authenticateTag";
constexpr const char* kCompleteTagAuthEndpoint = "/api/completeTagAuth";
constexpr const char* kUploadUsageEndpoint = "/api/uploadUsage";

// Upper bound on a gateway RPC round-trip. Each call's future is resolved
// ONLY by the pw_rpc response callback, so if the TCP link drops after the
// request is sent but before the response arrives, the callback never fires
// and the awaiting coroutine would hang forever — wedging the terminal, since
// the per-method `.active()` guard then rejects every later tap with
// Unavailable until reboot. Racing each await against this deadline
// guarantees the call completes; on expiry we cancel the in-flight call so
// the guard clears. Generous enough to tolerate a cold Cloud Function +
// Firestore round-trip.
constexpr pw::chrono::SystemClock::duration kGatewayRpcDeadline =
    std::chrono::seconds(20);

// Maximum payload size for serialization.
constexpr size_t kMaxPayloadSize = 512;

// Type aliases for gateway service
using GatewayClient = maco::gateway::pw_rpc::nanopb::GatewayService::Client;

/// Encode a TerminalCheckinRequest with the given tag UID and machine ID.
/// Caller is responsible for validating machine_id is non-empty and fits.
pw::Result<size_t> EncodeTerminalCheckinRequest(const TagUid& tag_uid,
                                                 const FirebaseId& machine_id,
                                                 pw::ByteSpan buffer) {
  maco_proto_firebase_rpc_TerminalCheckinRequest request =
      maco_proto_firebase_rpc_TerminalCheckinRequest_init_zero;

  // Copy tag UID bytes
  request.has_token_id = true;
  auto tag_bytes = tag_uid.bytes();
  std::memcpy(request.token_id.value, tag_bytes.data(), TagUid::kSize);

  request.has_machine_id = true;
  auto machine_id_str = machine_id.value();
  std::memcpy(request.machine_id.value, machine_id_str.data(),
              machine_id_str.size());
  // nanopb-generated buffer is sized for max FirebaseId + NUL terminator.
  request.machine_id.value[machine_id_str.size()] = '\0';

  pb_ostream_t stream = pb_ostream_from_buffer(
      reinterpret_cast<pb_byte_t*>(buffer.data()), buffer.size());
  if (!pb_encode(&stream, maco_proto_firebase_rpc_TerminalCheckinRequest_fields,
                 &request)) {
    return pw::Status::Internal();
  }
  return stream.bytes_written;
}

/// Encode an AuthenticateTagRequest.
pw::Result<size_t> EncodeAuthenticateTagRequest(const TagUid& tag_uid,
                                                 Key key_slot,
                                                 pw::ConstByteSpan ntag_challenge,
                                                 pw::ByteSpan buffer) {
  maco_proto_firebase_rpc_AuthenticateTagRequest request =
      maco_proto_firebase_rpc_AuthenticateTagRequest_init_zero;

  // Copy tag UID bytes
  request.has_tag_id = true;
  auto tag_bytes = tag_uid.bytes();
  std::memcpy(request.tag_id.value, tag_bytes.data(), TagUid::kSize);

  // Set key slot
  request.key_slot = static_cast<maco_proto_Key>(key_slot);

  // Copy ntag challenge
  if (ntag_challenge.size() > sizeof(request.ntag_challenge)) {
    return pw::Status::InvalidArgument();
  }
  std::memcpy(request.ntag_challenge, ntag_challenge.data(),
              ntag_challenge.size());

  pb_ostream_t stream = pb_ostream_from_buffer(
      reinterpret_cast<pb_byte_t*>(buffer.data()), buffer.size());
  if (!pb_encode(&stream, maco_proto_firebase_rpc_AuthenticateTagRequest_fields,
                 &request)) {
    return pw::Status::Internal();
  }
  return stream.bytes_written;
}

/// Encode a CompleteTagAuthRequest.
pw::Result<size_t> EncodeCompleteTagAuthRequest(
    const FirebaseId& auth_id,
    pw::ConstByteSpan encrypted_tag_response,
    pw::ByteSpan buffer) {
  maco_proto_firebase_rpc_CompleteTagAuthRequest request =
      maco_proto_firebase_rpc_CompleteTagAuthRequest_init_zero;

  // Copy auth_id string
  request.has_auth_id = true;
  auto auth_id_str = auth_id.value();
  if (auth_id_str.size() >= sizeof(request.auth_id.value)) {
    return pw::Status::InvalidArgument();
  }
  std::memcpy(request.auth_id.value, auth_id_str.data(), auth_id_str.size());
  request.auth_id.value[auth_id_str.size()] = '\0';

  // Copy encrypted tag response
  if (encrypted_tag_response.size() > sizeof(request.encrypted_tag_response)) {
    return pw::Status::InvalidArgument();
  }
  std::memcpy(request.encrypted_tag_response, encrypted_tag_response.data(),
              encrypted_tag_response.size());

  pb_ostream_t stream = pb_ostream_from_buffer(
      reinterpret_cast<pb_byte_t*>(buffer.data()), buffer.size());
  if (!pb_encode(&stream,
                 maco_proto_firebase_rpc_CompleteTagAuthRequest_fields,
                 &request)) {
    return pw::Status::Internal();
  }
  return stream.bytes_written;
}

// Guards the value-preserving `static_cast` below against silent drift: the
// wire enum (nanopb, generated from proto/firebase_rpc/auth.proto) and
// `firebase::RejectionReason` (firebase/public/firebase/types.h) are
// maintained independently and must keep matching numeric values (issue
// #535). A mismatch here fails the build instead of silently mis-decoding.
static_assert(static_cast<int>(RejectionReason::kMissingPermission) ==
              maco_proto_firebase_rpc_RejectionReason_REJECTION_REASON_MISSING_PERMISSION);
static_assert(static_cast<int>(RejectionReason::kStaleCheckout) ==
              maco_proto_firebase_rpc_RejectionReason_REJECTION_REASON_STALE_CHECKOUT);
static_assert(static_cast<int>(RejectionReason::kTokenUnknown) ==
              maco_proto_firebase_rpc_RejectionReason_REJECTION_REASON_TOKEN_UNKNOWN);
static_assert(static_cast<int>(RejectionReason::kTokenDeactivated) ==
              maco_proto_firebase_rpc_RejectionReason_REJECTION_REASON_TOKEN_DEACTIVATED);

/// Decode TerminalCheckinResponse with proper oneof handling.
pw::Result<CheckinResult> DecodeCheckinResponse(pw::ConstByteSpan payload) {
  maco_proto_firebase_rpc_TerminalCheckinResponse response =
      maco_proto_firebase_rpc_TerminalCheckinResponse_init_zero;

  pb_istream_t stream = pb_istream_from_buffer(
      reinterpret_cast<const pb_byte_t*>(payload.data()), payload.size());
  if (!pb_decode(&stream,
                 maco_proto_firebase_rpc_TerminalCheckinResponse_fields,
                 &response)) {
    PW_LOG_ERROR("Failed to decode TerminalCheckinResponse: %s",
                 PB_GET_ERROR(&stream));
    return pw::Status::DataLoss();
  }

  switch (response.which_result) {
    case maco_proto_firebase_rpc_TerminalCheckinResponse_authorized_tag: {
      auto user_id_result =
          FirebaseId::FromString(response.result.authorized.user_id.value);
      if (!user_id_result.ok()) {
        return pw::Status::DataLoss();
      }

      auto auth_id_result = FirebaseId::FromString(
          response.result.authorized.authentication_id.value);
      if (!auth_id_result.ok()) {
        return pw::Status::DataLoss();
      }

      return CheckinAuthorized{
          .user_id = *user_id_result,
          .user_label =
              pw::InlineString<64>(response.result.authorized.user_label),
          .authentication_id = *auth_id_result,
      };
    }
    case maco_proto_firebase_rpc_TerminalCheckinResponse_rejected_tag:
      return CheckinRejected{
          .message = pw::InlineString<128>(response.result.rejected.message),
          .reason = static_cast<RejectionReason>(
              response.result.rejected.reason),
          .action_url =
              pw::InlineString<128>(response.result.rejected.action_url),
      };
    default:
      PW_LOG_ERROR("TerminalCheckinResponse missing oneof result field");
      return pw::Status::DataLoss();
  }
}

/// Decode AuthenticateTagResponse.
pw::Result<AuthenticateTagResponse> DecodeAuthenticateTagResponse(
    pw::ConstByteSpan payload) {
  maco_proto_firebase_rpc_AuthenticateTagResponse response =
      maco_proto_firebase_rpc_AuthenticateTagResponse_init_zero;

  pb_istream_t stream = pb_istream_from_buffer(
      reinterpret_cast<const pb_byte_t*>(payload.data()), payload.size());
  if (!pb_decode(&stream,
                 maco_proto_firebase_rpc_AuthenticateTagResponse_fields,
                 &response)) {
    PW_LOG_ERROR("Failed to decode AuthenticateTagResponse");
    return pw::Status::DataLoss();
  }

  auto auth_id_result = FirebaseId::FromString(response.auth_id.value);
  if (!auth_id_result.ok()) {
    return pw::Status::DataLoss();
  }

  AuthenticateTagResponse result{
      .auth_id = *auth_id_result,
      .cloud_challenge = {},
      .cloud_challenge_size = sizeof(response.cloud_challenge),
  };
  std::memcpy(result.cloud_challenge.data(), response.cloud_challenge,
              sizeof(response.cloud_challenge));

  return result;
}

/// Decode CompleteTagAuthResponse with proper oneof handling.
pw::Result<CompleteAuthResult> DecodeCompleteAuthResponse(
    pw::ConstByteSpan payload) {
  maco_proto_firebase_rpc_CompleteTagAuthResponse response =
      maco_proto_firebase_rpc_CompleteTagAuthResponse_init_zero;

  pb_istream_t stream = pb_istream_from_buffer(
      reinterpret_cast<const pb_byte_t*>(payload.data()), payload.size());
  if (!pb_decode(&stream,
                 maco_proto_firebase_rpc_CompleteTagAuthResponse_fields,
                 &response)) {
    PW_LOG_ERROR("Failed to decode CompleteTagAuthResponse");
    return pw::Status::DataLoss();
  }

  switch (response.which_result) {
    case maco_proto_firebase_rpc_CompleteTagAuthResponse_session_keys_tag: {
      CompleteAuthSuccess success{};
      std::memcpy(success.ses_auth_enc_key.data(),
                  response.result.session_keys.ses_auth_enc_key,
                  sizeof(success.ses_auth_enc_key));
      std::memcpy(success.ses_auth_mac_key.data(),
                  response.result.session_keys.ses_auth_mac_key,
                  sizeof(success.ses_auth_mac_key));
      std::memcpy(success.transaction_identifier.data(),
                  response.result.session_keys.transaction_identifier,
                  sizeof(success.transaction_identifier));
      std::memcpy(success.picc_capabilities.data(),
                  response.result.session_keys.picc_capabilities,
                  sizeof(success.picc_capabilities));
      return success;
    }
    case maco_proto_firebase_rpc_CompleteTagAuthResponse_rejected_tag:
      return CompleteAuthRejected{
          .message = pw::InlineString<128>(response.result.rejected.message),
      };
    default:
      PW_LOG_ERROR("CompleteTagAuthResponse missing oneof result field");
      return pw::Status::DataLoss();
  }
}

}  // namespace

FirebaseClient::FirebaseClient(pw::rpc::Client& rpc_client, uint32_t channel_id)
    : rpc_client_(rpc_client), channel_id_(channel_id) {}

pw::async2::Coro<pw::Result<CheckinResult>> FirebaseClient::TerminalCheckin(
    pw::async2::CoroContext cx,
    const TagUid& tag_uid,
    const FirebaseId& machine_id) {
  (void)cx;  // Context available for child coroutines if needed
  if (terminal_checkin_call_.active()) {
    PW_LOG_WARN("TerminalCheckin called while previous call still in flight");
    co_return pw::Status::Unavailable();
  }

  // Cloud requires machine_id (PR #194) to enforce machine.requiredPermission.
  // Reject empty IDs here so we don't waste a payload buffer + RPC round-trip.
  if (machine_id.empty()) {
    PW_LOG_ERROR("TerminalCheckin called with empty machine_id");
    co_return pw::Status::InvalidArgument();
  }

  // Serialize the request payload
  std::array<std::byte, kMaxPayloadSize> payload_buffer;
  auto encode_result =
      EncodeTerminalCheckinRequest(tag_uid, machine_id, payload_buffer);
  if (!encode_result.ok()) {
    PW_LOG_ERROR("Failed to encode TerminalCheckinRequest");
    co_return encode_result.status();
  }

  // Build ForwardRequest
  maco_gateway_ForwardRequest request = maco_gateway_ForwardRequest_init_zero;
  std::strncpy(request.endpoint, kTerminalCheckinEndpoint,
               sizeof(request.endpoint) - 1);
  std::memcpy(request.payload.bytes, payload_buffer.data(), *encode_result);
  request.payload.size = *encode_result;

  // Register future BEFORE starting the RPC. If the channel send fails,
  // pw_rpc calls the error callback synchronously during Forward().
  // ValueProvider::Resolve() silently drops the value if no future is
  // registered, so the future must exist before any callback can fire.
  auto future = terminal_checkin_provider_.Get();

  GatewayClient client(rpc_client_, channel_id_);
  terminal_checkin_call_ = client.Forward(
      request,
      [this](const maco_gateway_ForwardResponse& resp, pw::Status st) {
        if (!st.ok()) {
          PW_LOG_ERROR("TerminalCheckin RPC failed: %s", st.str());
          terminal_checkin_provider_.Resolve(st);
          return;
        }
        if (!resp.success) {
          PW_LOG_ERROR("TerminalCheckin returned error (http %u): %s",
                       static_cast<unsigned>(resp.http_status), resp.error);
          terminal_checkin_provider_.Resolve(pw::Status::Internal());
          return;
        }

        auto decode_result = DecodeCheckinResponse(pw::ConstByteSpan(
            reinterpret_cast<const std::byte*>(resp.payload.bytes),
            resp.payload.size));
        if (!decode_result.ok()) {
          PW_LOG_ERROR("Failed to decode TerminalCheckinResponse: %s",
                       decode_result.status().str());
          terminal_checkin_provider_.Resolve(decode_result.status());
          return;
        }

        terminal_checkin_provider_.Resolve(std::move(*decode_result));
      },
      [this](pw::Status st) {
        PW_LOG_ERROR("TerminalCheckin RPC error: %s", st.str());
        terminal_checkin_provider_.Resolve(st);
      });

  auto timed =
      co_await maco::async_util::RaceWithDeadline(
          std::move(future), pw::async2::GetSystemTimeProvider(),
          kGatewayRpcDeadline);
  if (!timed.ok()) {
    PW_LOG_ERROR("TerminalCheckin timed out; cancelling in-flight call");
    terminal_checkin_call_.Cancel().IgnoreError();
    co_return timed.status();
  }
  co_return std::move(*timed);
}

pw::async2::Coro<pw::Result<AuthenticateTagResponse>>
FirebaseClient::AuthenticateTag(pw::async2::CoroContext cx,
                                const TagUid& tag_uid,
                                Key key_slot,
                                pw::ConstByteSpan ntag_challenge) {
  (void)cx;  // Context available for child coroutines if needed
  if (authenticate_tag_call_.active()) {
    PW_LOG_WARN("AuthenticateTag called while previous call still in flight");
    co_return pw::Status::Unavailable();
  }

  // Serialize the request payload
  std::array<std::byte, kMaxPayloadSize> payload_buffer;
  auto encode_result = EncodeAuthenticateTagRequest(tag_uid, key_slot,
                                                     ntag_challenge,
                                                     payload_buffer);
  if (!encode_result.ok()) {
    PW_LOG_ERROR("Failed to encode AuthenticateTagRequest");
    co_return encode_result.status();
  }

  // Build ForwardRequest
  maco_gateway_ForwardRequest request = maco_gateway_ForwardRequest_init_zero;
  std::strncpy(request.endpoint, kAuthenticateTagEndpoint,
               sizeof(request.endpoint) - 1);
  std::memcpy(request.payload.bytes, payload_buffer.data(), *encode_result);
  request.payload.size = *encode_result;

  auto future = authenticate_tag_provider_.Get();

  GatewayClient client(rpc_client_, channel_id_);
  authenticate_tag_call_ = client.Forward(
      request,
      [this](const maco_gateway_ForwardResponse& resp, pw::Status st) {
        if (!st.ok()) {
          PW_LOG_ERROR("AuthenticateTag RPC failed: %s", st.str());
          authenticate_tag_provider_.Resolve(st);
          return;
        }
        if (!resp.success) {
          PW_LOG_ERROR("AuthenticateTag returned error (http %u): %s",
                       static_cast<unsigned>(resp.http_status), resp.error);
          authenticate_tag_provider_.Resolve(pw::Status::Internal());
          return;
        }

        auto decode_result = DecodeAuthenticateTagResponse(pw::ConstByteSpan(
            reinterpret_cast<const std::byte*>(resp.payload.bytes),
            resp.payload.size));
        if (!decode_result.ok()) {
          PW_LOG_ERROR("Failed to decode AuthenticateTagResponse: %s",
                       decode_result.status().str());
          authenticate_tag_provider_.Resolve(decode_result.status());
          return;
        }

        authenticate_tag_provider_.Resolve(std::move(*decode_result));
      },
      [this](pw::Status st) {
        PW_LOG_ERROR("AuthenticateTag RPC error: %s", st.str());
        authenticate_tag_provider_.Resolve(st);
      });

  auto timed =
      co_await maco::async_util::RaceWithDeadline(
          std::move(future), pw::async2::GetSystemTimeProvider(),
          kGatewayRpcDeadline);
  if (!timed.ok()) {
    PW_LOG_ERROR("AuthenticateTag timed out; cancelling in-flight call");
    authenticate_tag_call_.Cancel().IgnoreError();
    co_return timed.status();
  }
  co_return std::move(*timed);
}

pw::async2::Coro<pw::Result<CompleteAuthResult>> FirebaseClient::CompleteTagAuth(
    pw::async2::CoroContext cx,
    const FirebaseId& auth_id,
    pw::ConstByteSpan encrypted_tag_response) {
  (void)cx;  // Context available for child coroutines if needed
  if (complete_tag_auth_call_.active()) {
    PW_LOG_WARN("CompleteTagAuth called while previous call still in flight");
    co_return pw::Status::Unavailable();
  }

  // Serialize the request payload
  std::array<std::byte, kMaxPayloadSize> payload_buffer;
  auto encode_result =
      EncodeCompleteTagAuthRequest(auth_id, encrypted_tag_response,
                                    payload_buffer);
  if (!encode_result.ok()) {
    PW_LOG_ERROR("Failed to encode CompleteTagAuthRequest");
    co_return encode_result.status();
  }

  // Build ForwardRequest
  maco_gateway_ForwardRequest request = maco_gateway_ForwardRequest_init_zero;
  std::strncpy(request.endpoint, kCompleteTagAuthEndpoint,
               sizeof(request.endpoint) - 1);
  std::memcpy(request.payload.bytes, payload_buffer.data(), *encode_result);
  request.payload.size = *encode_result;

  auto future = complete_tag_auth_provider_.Get();

  GatewayClient client(rpc_client_, channel_id_);
  complete_tag_auth_call_ = client.Forward(
      request,
      [this](const maco_gateway_ForwardResponse& resp, pw::Status st) {
        if (!st.ok()) {
          PW_LOG_ERROR("CompleteTagAuth RPC failed: %s", st.str());
          complete_tag_auth_provider_.Resolve(st);
          return;
        }
        if (!resp.success) {
          PW_LOG_ERROR("CompleteTagAuth returned error (http %u): %s",
                       static_cast<unsigned>(resp.http_status), resp.error);
          complete_tag_auth_provider_.Resolve(pw::Status::Internal());
          return;
        }

        auto decode_result = DecodeCompleteAuthResponse(pw::ConstByteSpan(
            reinterpret_cast<const std::byte*>(resp.payload.bytes),
            resp.payload.size));
        if (!decode_result.ok()) {
          PW_LOG_ERROR("Failed to decode CompleteTagAuthResponse: %s",
                       decode_result.status().str());
          complete_tag_auth_provider_.Resolve(decode_result.status());
          return;
        }

        complete_tag_auth_provider_.Resolve(std::move(*decode_result));
      },
      [this](pw::Status st) {
        PW_LOG_ERROR("CompleteTagAuth RPC error: %s", st.str());
        complete_tag_auth_provider_.Resolve(st);
      });

  auto timed =
      co_await maco::async_util::RaceWithDeadline(
          std::move(future), pw::async2::GetSystemTimeProvider(),
          kGatewayRpcDeadline);
  if (!timed.ok()) {
    PW_LOG_ERROR("CompleteTagAuth timed out; cancelling in-flight call");
    complete_tag_auth_call_.Cancel().IgnoreError();
    co_return timed.status();
  }
  co_return std::move(*timed);
}

pw::async2::Coro<pw::Status> FirebaseClient::UploadUsage(
    pw::async2::CoroContext cx,
    pw::ConstByteSpan payload) {
  (void)cx;
  if (upload_usage_call_.active()) {
    PW_LOG_WARN("UploadUsage called while previous call still in flight");
    co_return pw::Status::Unavailable();
  }

  // Build ForwardRequest with pre-encoded payload
  maco_gateway_ForwardRequest request = maco_gateway_ForwardRequest_init_zero;
  std::strncpy(request.endpoint, kUploadUsageEndpoint,
               sizeof(request.endpoint) - 1);
  if (payload.size() > sizeof(request.payload.bytes)) {
    PW_LOG_ERROR("UploadUsage payload too large: %zu", payload.size());
    co_return pw::Status::ResourceExhausted();
  }
  std::memcpy(request.payload.bytes, payload.data(), payload.size());
  request.payload.size = payload.size();

  auto future = upload_usage_provider_.Get();

  GatewayClient client(rpc_client_, channel_id_);
  upload_usage_call_ = client.Forward(
      request,
      [this](const maco_gateway_ForwardResponse& resp, pw::Status st) {
        if (!st.ok()) {
          PW_LOG_ERROR("UploadUsage RPC failed: %s", st.str());
          upload_usage_provider_.Resolve(st);
          return;
        }
        if (!resp.success) {
          PW_LOG_ERROR("UploadUsage returned error (http %u): %s",
                       static_cast<unsigned>(resp.http_status), resp.error);
          upload_usage_provider_.Resolve(pw::Status::Internal());
          return;
        }
        upload_usage_provider_.Resolve(pw::OkStatus());
      },
      [this](pw::Status st) {
        PW_LOG_ERROR("UploadUsage RPC error: %s", st.str());
        upload_usage_provider_.Resolve(st);
      });

  auto timed =
      co_await maco::async_util::RaceWithDeadline(
          std::move(future), pw::async2::GetSystemTimeProvider(),
          kGatewayRpcDeadline);
  if (!timed.ok()) {
    PW_LOG_ERROR("UploadUsage timed out; cancelling in-flight call");
    upload_usage_call_.Cancel().IgnoreError();
    co_return timed.status();
  }
  co_return *timed;
}

}  // namespace maco::firebase
