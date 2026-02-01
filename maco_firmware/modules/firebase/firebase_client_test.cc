// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/// @file firebase_client_test.cc
/// @brief Unit tests for FirebaseClient coroutine-based API.

#include "firebase/firebase_client.h"

#include <array>
#include <cstring>
#include <optional>
#include <variant>

#include "firebase_rpc/auth.pb.h"
#include "gateway/gateway_service.pb.h"
#include "gateway/gateway_service.rpc.pb.h"
#include "pb_encode.h"
#include "pw_allocator/testing.h"
#include "pw_async2/basic_dispatcher.h"
#include "pw_async2/coro_or_else_task.h"
#include "pw_bytes/array.h"
#include "pw_rpc/nanopb/client_testing.h"
#include "pw_unit_test/framework.h"

namespace maco::firebase {
namespace {

// Alias for the Gateway service client
using GatewayService = maco::gateway::pw_rpc::nanopb::GatewayService;

// Test allocator with sufficient space for coroutine frames
constexpr size_t kAllocatorSize = 4096;

// Helper to encode an Authorized response (no existing auth)
pw::Result<size_t> EncodeAuthorizedResponse(const char* user_id,
                                            const char* user_label,
                                            pw::ByteSpan buffer) {
  maco_proto_firebase_rpc_TerminalCheckinResponse response =
      maco_proto_firebase_rpc_TerminalCheckinResponse_init_zero;

  response.which_result =
      maco_proto_firebase_rpc_TerminalCheckinResponse_authorized_tag;
  response.result.authorized.has_user_id = true;
  std::strncpy(response.result.authorized.user_id.value, user_id,
               sizeof(response.result.authorized.user_id.value) - 1);
  std::strncpy(response.result.authorized.user_label, user_label,
               sizeof(response.result.authorized.user_label) - 1);
  // authentication_id left empty (has_authentication_id = false by init_zero)

  pb_ostream_t stream = pb_ostream_from_buffer(
      reinterpret_cast<pb_byte_t*>(buffer.data()), buffer.size());
  if (!pb_encode(&stream,
                 maco_proto_firebase_rpc_TerminalCheckinResponse_fields,
                 &response)) {
    return pw::Status::Internal();
  }
  return stream.bytes_written;
}

// Helper to encode a Rejected response
pw::Result<size_t> EncodeRejectedResponse(const char* message,
                                          pw::ByteSpan buffer) {
  maco_proto_firebase_rpc_TerminalCheckinResponse response =
      maco_proto_firebase_rpc_TerminalCheckinResponse_init_zero;

  response.which_result =
      maco_proto_firebase_rpc_TerminalCheckinResponse_rejected_tag;
  std::strncpy(response.result.rejected.message, message,
               sizeof(response.result.rejected.message) - 1);

  pb_ostream_t stream = pb_ostream_from_buffer(
      reinterpret_cast<pb_byte_t*>(buffer.data()), buffer.size());
  if (!pb_encode(&stream,
                 maco_proto_firebase_rpc_TerminalCheckinResponse_fields,
                 &response)) {
    return pw::Status::Internal();
  }
  return stream.bytes_written;
}

// Helper to encode an AuthenticateTagResponse
pw::Result<size_t> EncodeAuthenticateTagResponse(
    const char* auth_id,
    pw::ConstByteSpan cloud_challenge,
    pw::ByteSpan buffer) {
  maco_proto_firebase_rpc_AuthenticateTagResponse response =
      maco_proto_firebase_rpc_AuthenticateTagResponse_init_zero;

  response.has_auth_id = true;
  std::strncpy(response.auth_id.value, auth_id,
               sizeof(response.auth_id.value) - 1);

  if (cloud_challenge.size() <= sizeof(response.cloud_challenge)) {
    std::memcpy(response.cloud_challenge, cloud_challenge.data(),
                cloud_challenge.size());
  }

  pb_ostream_t stream = pb_ostream_from_buffer(
      reinterpret_cast<pb_byte_t*>(buffer.data()), buffer.size());
  if (!pb_encode(&stream,
                 maco_proto_firebase_rpc_AuthenticateTagResponse_fields,
                 &response)) {
    return pw::Status::Internal();
  }
  return stream.bytes_written;
}

// Helper to encode a CompleteTagAuthResponse with session keys
pw::Result<size_t> EncodeCompleteTagAuthResponse(pw::ConstByteSpan enc_key,
                                                 pw::ConstByteSpan mac_key,
                                                 pw::ConstByteSpan ti,
                                                 pw::ConstByteSpan picc_cap,
                                                 pw::ByteSpan buffer) {
  maco_proto_firebase_rpc_CompleteTagAuthResponse response =
      maco_proto_firebase_rpc_CompleteTagAuthResponse_init_zero;

  response.which_result =
      maco_proto_firebase_rpc_CompleteTagAuthResponse_session_keys_tag;

  std::memcpy(response.result.session_keys.ses_auth_enc_key, enc_key.data(),
              enc_key.size());
  std::memcpy(response.result.session_keys.ses_auth_mac_key, mac_key.data(),
              mac_key.size());
  std::memcpy(response.result.session_keys.transaction_identifier, ti.data(),
              ti.size());
  std::memcpy(response.result.session_keys.picc_capabilities, picc_cap.data(),
              picc_cap.size());

  pb_ostream_t stream = pb_ostream_from_buffer(
      reinterpret_cast<pb_byte_t*>(buffer.data()), buffer.size());
  if (!pb_encode(&stream,
                 maco_proto_firebase_rpc_CompleteTagAuthResponse_fields,
                 &response)) {
    return pw::Status::Internal();
  }
  return stream.bytes_written;
}

// Test fixture for FirebaseClient tests
class FirebaseClientTest : public ::testing::Test {
 protected:
  // Create the Firebase client using the test context
  FirebaseClient CreateClient() {
    return FirebaseClient(rpc_ctx_.client(), rpc_ctx_.channel().id());
  }

  // Send a successful ForwardResponse with the given payload
  void SendForwardResponse(pw::ConstByteSpan payload) {
    maco_gateway_ForwardResponse response = maco_gateway_ForwardResponse_init_zero;
    response.success = true;
    response.http_status = 200;
    std::memcpy(response.payload.bytes, payload.data(), payload.size());
    response.payload.size = payload.size();

    rpc_ctx_.server().SendResponse<GatewayService::Forward>(response,
                                                            pw::OkStatus());
  }

  // Send an error ForwardResponse
  void SendForwardError(uint32_t http_status, const char* error_message) {
    maco_gateway_ForwardResponse response = maco_gateway_ForwardResponse_init_zero;
    response.success = false;
    response.http_status = http_status;
    std::strncpy(response.error, error_message, sizeof(response.error) - 1);

    rpc_ctx_.server().SendResponse<GatewayService::Forward>(response,
                                                            pw::OkStatus());
  }

  // Send an RPC-level error
  void SendRpcError(pw::Status status) {
    rpc_ctx_.server().SendServerError<GatewayService::Forward>(status);
  }

  // Run the dispatcher until the task completes or max iterations
  bool RunUntilComplete(pw::async2::CoroOrElseTask& task,
                        int max_iterations = 100) {
    int iterations = 0;
    while (task.IsRegistered() && iterations++ < max_iterations) {
      dispatcher_.RunUntilStalled();
    }
    return iterations < max_iterations;
  }

  pw::rpc::NanopbClientTestContext<10, 512, 1024> rpc_ctx_;
  pw::async2::BasicDispatcher dispatcher_;
  pw::allocator::test::AllocatorForTest<kAllocatorSize> test_allocator_;
};

// ============================================================================
// TerminalCheckin Tests
// ============================================================================

TEST_F(FirebaseClientTest, TerminalCheckin_Authorized) {
  auto client = CreateClient();

  // Result storage
  std::optional<pw::Result<CheckinResult>> result;

  // Create TagUid from bytes
  auto tag_uid_result = TagUid::FromBytes(
      pw::bytes::Array<0x04, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66>());
  ASSERT_TRUE(tag_uid_result.ok());

  // Create the test coroutine
  pw::async2::CoroContext coro_cx(test_allocator_);
  auto test_coro =
      [&](pw::async2::CoroContext& cx) -> pw::async2::Coro<pw::Status> {
    result = co_await client.TerminalCheckin(cx, *tag_uid_result);
    co_return pw::OkStatus();
  };

  auto coro = test_coro(coro_cx);
  pw::async2::CoroOrElseTask task(std::move(coro),
                                  [](pw::Status) { /* Error handler */ });

  dispatcher_.Post(task);

  // Run dispatcher - this starts the RPC call
  dispatcher_.RunUntilStalled();

  // Verify an RPC request was sent
  EXPECT_EQ(rpc_ctx_.output().total_packets(), 1u);

  // Now inject the response - authorized
  std::array<std::byte, 256> payload_buffer;
  auto encode_result =
      EncodeAuthorizedResponse("user123", "Test User", payload_buffer);
  ASSERT_TRUE(encode_result.ok());

  SendForwardResponse(
      pw::ConstByteSpan(payload_buffer.data(), *encode_result));

  // Run until complete
  ASSERT_TRUE(RunUntilComplete(task));

  // Verify result
  ASSERT_TRUE(result.has_value());
  EXPECT_TRUE(result->ok());
  EXPECT_TRUE(std::holds_alternative<CheckinAuthorized>(result->value()));
}

TEST_F(FirebaseClientTest, TerminalCheckin_Rejected) {
  auto client = CreateClient();

  std::optional<pw::Result<CheckinResult>> result;

  auto tag_uid_result = TagUid::FromBytes(
      pw::bytes::Array<0x04, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66>());
  ASSERT_TRUE(tag_uid_result.ok());

  pw::async2::CoroContext coro_cx(test_allocator_);
  auto test_coro =
      [&](pw::async2::CoroContext& cx) -> pw::async2::Coro<pw::Status> {
    result = co_await client.TerminalCheckin(cx, *tag_uid_result);
    co_return pw::OkStatus();
  };

  auto coro = test_coro(coro_cx);
  pw::async2::CoroOrElseTask task(std::move(coro),
                                  [](pw::Status) { /* Error handler */ });

  dispatcher_.Post(task);
  dispatcher_.RunUntilStalled();

  // Inject rejected response
  std::array<std::byte, 256> payload_buffer;
  auto encode_result = EncodeRejectedResponse("Unknown tag", payload_buffer);
  ASSERT_TRUE(encode_result.ok());

  SendForwardResponse(
      pw::ConstByteSpan(payload_buffer.data(), *encode_result));

  ASSERT_TRUE(RunUntilComplete(task));

  ASSERT_TRUE(result.has_value());
  EXPECT_TRUE(result->ok());
  EXPECT_TRUE(std::holds_alternative<CheckinRejected>(result->value()));
}

TEST_F(FirebaseClientTest, TerminalCheckin_ForwardError) {
  auto client = CreateClient();

  std::optional<pw::Result<CheckinResult>> result;

  auto tag_uid_result = TagUid::FromBytes(
      pw::bytes::Array<0x04, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66>());
  ASSERT_TRUE(tag_uid_result.ok());

  pw::async2::CoroContext coro_cx(test_allocator_);
  auto test_coro =
      [&](pw::async2::CoroContext& cx) -> pw::async2::Coro<pw::Status> {
    result = co_await client.TerminalCheckin(cx, *tag_uid_result);
    co_return pw::OkStatus();
  };

  auto coro = test_coro(coro_cx);
  pw::async2::CoroOrElseTask task(std::move(coro),
                                  [](pw::Status) { /* Error handler */ });

  dispatcher_.Post(task);
  dispatcher_.RunUntilStalled();

  // Inject error response from gateway
  SendForwardError(500, "Internal server error");

  ASSERT_TRUE(RunUntilComplete(task));

  ASSERT_TRUE(result.has_value());
  EXPECT_FALSE(result->ok());
  EXPECT_EQ(result->status(), pw::Status::Internal());
}

TEST_F(FirebaseClientTest, TerminalCheckin_RpcError) {
  auto client = CreateClient();

  std::optional<pw::Result<CheckinResult>> result;

  auto tag_uid_result = TagUid::FromBytes(
      pw::bytes::Array<0x04, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66>());
  ASSERT_TRUE(tag_uid_result.ok());

  pw::async2::CoroContext coro_cx(test_allocator_);
  auto test_coro =
      [&](pw::async2::CoroContext& cx) -> pw::async2::Coro<pw::Status> {
    result = co_await client.TerminalCheckin(cx, *tag_uid_result);
    co_return pw::OkStatus();
  };

  auto coro = test_coro(coro_cx);
  pw::async2::CoroOrElseTask task(std::move(coro),
                                  [](pw::Status) { /* Error handler */ });

  dispatcher_.Post(task);
  dispatcher_.RunUntilStalled();

  // Inject RPC-level error
  SendRpcError(pw::Status::Unavailable());

  ASSERT_TRUE(RunUntilComplete(task));

  ASSERT_TRUE(result.has_value());
  EXPECT_FALSE(result->ok());
  EXPECT_EQ(result->status(), pw::Status::Unavailable());
}

// ============================================================================
// AuthenticateTag Tests
// ============================================================================

TEST_F(FirebaseClientTest, AuthenticateTag_Success) {
  auto client = CreateClient();

  std::optional<pw::Result<AuthenticateTagResponse>> result;

  auto tag_uid_result = TagUid::FromBytes(
      pw::bytes::Array<0x04, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66>());
  ASSERT_TRUE(tag_uid_result.ok());

  pw::async2::CoroContext coro_cx(test_allocator_);
  auto test_coro =
      [&](pw::async2::CoroContext& cx) -> pw::async2::Coro<pw::Status> {
    auto ntag_challenge =
        pw::bytes::Array<0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09,
                         0x0A, 0x0B, 0x0C, 0x0D, 0x0E, 0x0F, 0x10>();

    result = co_await client.AuthenticateTag(cx, *tag_uid_result,
                                             Key::KEY_APPLICATION,
                                             ntag_challenge);
    co_return pw::OkStatus();
  };

  auto coro = test_coro(coro_cx);
  pw::async2::CoroOrElseTask task(std::move(coro),
                                  [](pw::Status) { /* Error handler */ });

  dispatcher_.Post(task);
  dispatcher_.RunUntilStalled();

  // Inject success response
  constexpr auto kCloudChallenge = pw::bytes::Array<
      0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF, 0x11, 0x22, 0x33, 0x44, 0x55,
      0x66, 0x77, 0x88, 0x99, 0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66,
      0x77, 0x88, 0x99, 0x00, 0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF>();

  std::array<std::byte, 256> payload_buffer;
  auto encode_result =
      EncodeAuthenticateTagResponse("auth_id_123", kCloudChallenge,
                                    payload_buffer);
  ASSERT_TRUE(encode_result.ok());

  SendForwardResponse(
      pw::ConstByteSpan(payload_buffer.data(), *encode_result));

  ASSERT_TRUE(RunUntilComplete(task));

  ASSERT_TRUE(result.has_value());
  ASSERT_TRUE(result->ok());
  EXPECT_EQ(result->value().auth_id.value(), "auth_id_123");
  EXPECT_EQ(result->value().cloud_challenge_size, 32u);
}

// ============================================================================
// CompleteTagAuth Tests
// ============================================================================

TEST_F(FirebaseClientTest, CompleteTagAuth_Success) {
  auto client = CreateClient();

  std::optional<pw::Result<CompleteAuthResult>> result;

  auto auth_id_result = FirebaseId::FromString("auth_id_123");
  ASSERT_TRUE(auth_id_result.ok());

  pw::async2::CoroContext coro_cx(test_allocator_);
  auto test_coro =
      [&](pw::async2::CoroContext& cx) -> pw::async2::Coro<pw::Status> {
    auto encrypted_response = pw::bytes::Array<
        0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0B,
        0x0C, 0x0D, 0x0E, 0x0F, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16,
        0x17, 0x18, 0x19, 0x1A, 0x1B, 0x1C, 0x1D, 0x1E, 0x1F, 0x20>();

    result = co_await client.CompleteTagAuth(cx, *auth_id_result,
                                             encrypted_response);
    co_return pw::OkStatus();
  };

  auto coro = test_coro(coro_cx);
  pw::async2::CoroOrElseTask task(std::move(coro),
                                  [](pw::Status) { /* Error handler */ });

  dispatcher_.Post(task);
  dispatcher_.RunUntilStalled();

  // Inject success response with session keys
  constexpr auto kEncKey = pw::bytes::Array<0x11, 0x22, 0x33, 0x44, 0x55, 0x66,
                                            0x77, 0x88, 0x99, 0xAA, 0xBB, 0xCC,
                                            0xDD, 0xEE, 0xFF, 0x00>();
  constexpr auto kMacKey = pw::bytes::Array<0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF,
                                            0x00, 0x11, 0x22, 0x33, 0x44, 0x55,
                                            0x66, 0x77, 0x88, 0x99>();
  constexpr auto kTi = pw::bytes::Array<0x01, 0x02, 0x03, 0x04>();
  constexpr auto kPiccCap =
      pw::bytes::Array<0x05, 0x06, 0x07, 0x08, 0x09, 0x0A>();

  std::array<std::byte, 256> payload_buffer;
  auto encode_result =
      EncodeCompleteTagAuthResponse(kEncKey, kMacKey, kTi, kPiccCap,
                                    payload_buffer);
  ASSERT_TRUE(encode_result.ok());

  SendForwardResponse(
      pw::ConstByteSpan(payload_buffer.data(), *encode_result));

  ASSERT_TRUE(RunUntilComplete(task));

  ASSERT_TRUE(result.has_value());
  EXPECT_TRUE(result->ok());
  EXPECT_TRUE(std::holds_alternative<CompleteAuthSuccess>(result->value()));
}

// ============================================================================
// Request Verification Tests
// ============================================================================

TEST_F(FirebaseClientTest, TerminalCheckin_SendsRequest) {
  auto client = CreateClient();

  std::optional<pw::Result<CheckinResult>> result;

  auto tag_uid_result = TagUid::FromBytes(
      pw::bytes::Array<0x04, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66>());
  ASSERT_TRUE(tag_uid_result.ok());

  pw::async2::CoroContext coro_cx(test_allocator_);
  auto test_coro =
      [&](pw::async2::CoroContext& cx) -> pw::async2::Coro<pw::Status> {
    result = co_await client.TerminalCheckin(cx, *tag_uid_result);
    co_return pw::OkStatus();
  };

  auto coro = test_coro(coro_cx);
  pw::async2::CoroOrElseTask task(std::move(coro),
                                  [](pw::Status) { /* Error handler */ });

  dispatcher_.Post(task);
  dispatcher_.RunUntilStalled();

  // Verify the request was sent
  EXPECT_EQ(rpc_ctx_.output().total_packets(), 1u);

  // Send response to complete the test cleanly
  std::array<std::byte, 256> payload_buffer;
  auto encode_result =
      EncodeAuthorizedResponse("user123", "Test User", payload_buffer);
  ASSERT_TRUE(encode_result.ok());

  SendForwardResponse(
      pw::ConstByteSpan(payload_buffer.data(), *encode_result));

  ASSERT_TRUE(RunUntilComplete(task));
}

// ============================================================================
// Concurrent Call Tests
// ============================================================================

TEST_F(FirebaseClientTest, TerminalCheckin_ConcurrentCallReturnsUnavailable) {
  auto client = CreateClient();

  // Storage for results from both calls
  std::optional<pw::Result<CheckinResult>> result1;
  std::optional<pw::Result<CheckinResult>> result2;

  auto tag_uid_result1 = TagUid::FromBytes(
      pw::bytes::Array<0x04, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66>());
  ASSERT_TRUE(tag_uid_result1.ok());

  auto tag_uid_result2 = TagUid::FromBytes(
      pw::bytes::Array<0x04, 0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF>());
  ASSERT_TRUE(tag_uid_result2.ok());

  // First coroutine - starts the call
  pw::async2::CoroContext coro_cx1(test_allocator_);
  auto test_coro1 =
      [&](pw::async2::CoroContext& cx) -> pw::async2::Coro<pw::Status> {
    result1 = co_await client.TerminalCheckin(cx, *tag_uid_result1);
    co_return pw::OkStatus();
  };

  // Second coroutine - tries to start while first is in flight
  pw::async2::CoroContext coro_cx2(test_allocator_);
  auto test_coro2 =
      [&](pw::async2::CoroContext& cx) -> pw::async2::Coro<pw::Status> {
    result2 = co_await client.TerminalCheckin(cx, *tag_uid_result2);
    co_return pw::OkStatus();
  };

  auto coro1 = test_coro1(coro_cx1);
  pw::async2::CoroOrElseTask task1(std::move(coro1),
                                   [](pw::Status) { /* Error handler */ });

  auto coro2 = test_coro2(coro_cx2);
  pw::async2::CoroOrElseTask task2(std::move(coro2),
                                   [](pw::Status) { /* Error handler */ });

  // Start first call
  dispatcher_.Post(task1);
  dispatcher_.RunUntilStalled();

  // Verify first call is in flight
  EXPECT_EQ(rpc_ctx_.output().total_packets(), 1u);

  // Start second call while first is still pending
  dispatcher_.Post(task2);
  dispatcher_.RunUntilStalled();

  // Second call should complete immediately with Unavailable
  ASSERT_TRUE(result2.has_value());
  EXPECT_FALSE(result2->ok());
  EXPECT_EQ(result2->status(), pw::Status::Unavailable());

  // First call should still be pending
  EXPECT_FALSE(result1.has_value());

  // Complete the first call
  std::array<std::byte, 256> payload_buffer;
  auto encode_result =
      EncodeAuthorizedResponse("user123", "Test User", payload_buffer);
  ASSERT_TRUE(encode_result.ok());
  SendForwardResponse(
      pw::ConstByteSpan(payload_buffer.data(), *encode_result));

  ASSERT_TRUE(RunUntilComplete(task1));
  ASSERT_TRUE(result1.has_value());
  EXPECT_TRUE(result1->ok());
}

}  // namespace
}  // namespace maco::firebase
