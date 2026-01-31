// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/// @file firebase_client_test.cc
/// @brief Unit tests for FirebaseClient coroutine-based API.

#include "firebase/firebase_client.h"

#include <array>
#include <optional>

#include "firebase_rpc/session.pwpb.h"
#include "gateway/gateway_service.pwpb.h"
#include "gateway/gateway_service.rpc.pwpb.h"
#include "pw_allocator/testing.h"
#include "pw_async2/basic_dispatcher.h"
#include "pw_async2/coro_or_else_task.h"
#include "pw_bytes/array.h"
#include "pw_rpc/pwpb/client_testing.h"
#include "pw_unit_test/framework.h"

namespace maco::firebase {
namespace {

// Alias for the Gateway service client
using GatewayService = maco::gateway::pw_rpc::pwpb::GatewayService;

// Test allocator with sufficient space for coroutine frames
constexpr size_t kAllocatorSize = 4096;

// Helper to encode an AuthRequired response
pw::Result<size_t> EncodeAuthRequiredResponse(
    pw::ByteSpan buffer) {
  maco::proto::firebase_rpc::pwpb::StartSessionResponse::MemoryEncoder encoder(
      buffer);
  // Write an empty AuthRequired message
  auto status = encoder.WriteAuthRequiredMessage(
      [](maco::proto::firebase_rpc::pwpb::AuthRequired::StreamEncoder&) {
        return pw::OkStatus();
      });
  if (!status.ok()) {
    return status;
  }
  return encoder.size();
}

// Helper to encode a Rejected response
pw::Result<size_t> EncodeRejectedResponse(
    const char* message, pw::ByteSpan buffer) {
  maco::proto::firebase_rpc::pwpb::StartSessionResponse::MemoryEncoder encoder(
      buffer);
  auto status = encoder.WriteRejectedMessage(
      [message](
          maco::proto::firebase_rpc::pwpb::Rejected::StreamEncoder& rejected) {
        return rejected.WriteMessage(message);
      });
  if (!status.ok()) {
    return status;
  }
  return encoder.size();
}

// Helper to encode an AuthenticateNewSessionResponse
pw::Result<size_t> EncodeAuthenticateNewSessionResponse(
    const char* session_id,
    pw::ConstByteSpan cloud_challenge,
    pw::ByteSpan buffer) {
  maco::proto::firebase_rpc::pwpb::AuthenticateNewSessionResponse::MemoryEncoder
      encoder(buffer);

  auto status = encoder.WriteSessionIdMessage(
      [session_id](
          maco::proto::pwpb::FirebaseId::StreamEncoder& id_encoder) {
        return id_encoder.WriteValue(session_id);
      });
  if (!status.ok()) {
    return status;
  }

  status = encoder.WriteCloudChallenge(cloud_challenge);
  if (!status.ok()) {
    return status;
  }

  return encoder.size();
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
    maco::gateway::pwpb::ForwardResponse::Message response;
    response.success = true;
    response.http_status = 200;
    response.payload.assign(payload.begin(), payload.end());

    rpc_ctx_.server().SendResponse<GatewayService::Forward>(
        response, pw::OkStatus());
  }

  // Send an error ForwardResponse
  void SendForwardError(uint32_t http_status, const char* error_message) {
    maco::gateway::pwpb::ForwardResponse::Message response;
    response.success = false;
    response.http_status = http_status;
    response.error = error_message;

    rpc_ctx_.server().SendResponse<GatewayService::Forward>(
        response, pw::OkStatus());
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

  pw::rpc::PwpbClientTestContext<10, 512, 1024> rpc_ctx_;
  pw::async2::BasicDispatcher dispatcher_;
  pw::allocator::test::AllocatorForTest<kAllocatorSize> test_allocator_;
};

// ============================================================================
// StartSession Tests
// ============================================================================

TEST_F(FirebaseClientTest, StartSession_AuthRequired) {
  auto client = CreateClient();

  // Result storage
  std::optional<pw::Result<StartSessionResponse>> result;

  // Create the test coroutine
  pw::async2::CoroContext coro_cx(test_allocator_);
  auto test_coro = [&](pw::async2::CoroContext& cx)
      -> pw::async2::Coro<pw::Status> {
    TagUid tag_uid;
    tag_uid.value = pw::bytes::Array<0x04, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66>();

    result = co_await client.StartSession(cx, tag_uid);
    co_return pw::OkStatus();
  };

  auto coro = test_coro(coro_cx);
  pw::async2::CoroOrElseTask task(
      std::move(coro), [](pw::Status) { /* Error handler */ });

  dispatcher_.Post(task);

  // Run dispatcher - this starts the RPC call
  dispatcher_.RunUntilStalled();

  // Verify an RPC request was sent
  EXPECT_EQ(rpc_ctx_.output().total_packets(), 1u);

  // Now inject the response - auth required
  std::array<std::byte, 256> payload_buffer;
  auto encode_result =
      EncodeAuthRequiredResponse(payload_buffer);
  ASSERT_TRUE(encode_result.ok());

  SendForwardResponse(
      pw::ConstByteSpan(payload_buffer.data(), *encode_result));

  // Run until complete
  ASSERT_TRUE(RunUntilComplete(task));

  // Verify result
  ASSERT_TRUE(result.has_value());
  EXPECT_TRUE(result->ok());
  // Note: Detailed field checking requires understanding the OneOf decoder
  // which uses callbacks. For now we just verify the decode succeeded.
}

TEST_F(FirebaseClientTest, StartSession_Rejected) {
  auto client = CreateClient();

  std::optional<pw::Result<StartSessionResponse>> result;

  pw::async2::CoroContext coro_cx(test_allocator_);
  auto test_coro = [&](pw::async2::CoroContext& cx)
      -> pw::async2::Coro<pw::Status> {
    TagUid tag_uid;
    tag_uid.value = pw::bytes::Array<0x04, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66>();

    result = co_await client.StartSession(cx, tag_uid);
    co_return pw::OkStatus();
  };

  auto coro = test_coro(coro_cx);
  pw::async2::CoroOrElseTask task(
      std::move(coro), [](pw::Status) { /* Error handler */ });

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
}

TEST_F(FirebaseClientTest, StartSession_ForwardError) {
  auto client = CreateClient();

  std::optional<pw::Result<StartSessionResponse>> result;

  pw::async2::CoroContext coro_cx(test_allocator_);
  auto test_coro = [&](pw::async2::CoroContext& cx)
      -> pw::async2::Coro<pw::Status> {
    TagUid tag_uid;
    tag_uid.value = pw::bytes::Array<0x04, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66>();

    result = co_await client.StartSession(cx, tag_uid);
    co_return pw::OkStatus();
  };

  auto coro = test_coro(coro_cx);
  pw::async2::CoroOrElseTask task(
      std::move(coro), [](pw::Status) { /* Error handler */ });

  dispatcher_.Post(task);
  dispatcher_.RunUntilStalled();

  // Inject error response from gateway
  SendForwardError(500, "Internal server error");

  ASSERT_TRUE(RunUntilComplete(task));

  ASSERT_TRUE(result.has_value());
  EXPECT_FALSE(result->ok());
  EXPECT_EQ(result->status(), pw::Status::Internal());
}

TEST_F(FirebaseClientTest, StartSession_RpcError) {
  auto client = CreateClient();

  std::optional<pw::Result<StartSessionResponse>> result;

  pw::async2::CoroContext coro_cx(test_allocator_);
  auto test_coro = [&](pw::async2::CoroContext& cx)
      -> pw::async2::Coro<pw::Status> {
    TagUid tag_uid;
    tag_uid.value = pw::bytes::Array<0x04, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66>();

    result = co_await client.StartSession(cx, tag_uid);
    co_return pw::OkStatus();
  };

  auto coro = test_coro(coro_cx);
  pw::async2::CoroOrElseTask task(
      std::move(coro), [](pw::Status) { /* Error handler */ });

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
// AuthenticateNewSession Tests
// ============================================================================

TEST_F(FirebaseClientTest, AuthenticateNewSession_Success) {
  auto client = CreateClient();

  std::optional<pw::Result<AuthenticateNewSessionResponse>> result;

  pw::async2::CoroContext coro_cx(test_allocator_);
  auto test_coro = [&](pw::async2::CoroContext& cx)
      -> pw::async2::Coro<pw::Status> {
    TagUid tag_uid;
    tag_uid.value = pw::bytes::Array<0x04, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66>();

    auto ntag_challenge =
        pw::bytes::Array<0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
                         0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x0E, 0x0F, 0x10>();

    result = co_await client.AuthenticateNewSession(cx, tag_uid, ntag_challenge);
    co_return pw::OkStatus();
  };

  auto coro = test_coro(coro_cx);
  pw::async2::CoroOrElseTask task(
      std::move(coro), [](pw::Status) { /* Error handler */ });

  dispatcher_.Post(task);
  dispatcher_.RunUntilStalled();

  // Inject success response
  constexpr auto kCloudChallenge =
      pw::bytes::Array<0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF, 0x11, 0x22,
                       0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0x00,
                       0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88,
                       0x99, 0x00, 0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF>();

  std::array<std::byte, 256> payload_buffer;
  auto encode_result = EncodeAuthenticateNewSessionResponse(
      "new_session_id", kCloudChallenge, payload_buffer);
  ASSERT_TRUE(encode_result.ok());

  SendForwardResponse(
      pw::ConstByteSpan(payload_buffer.data(), *encode_result));

  ASSERT_TRUE(RunUntilComplete(task));

  ASSERT_TRUE(result.has_value());
  ASSERT_TRUE(result->ok());
  EXPECT_EQ(
      std::string_view(result->value().session_id.value.c_str()),
      "new_session_id");
  EXPECT_EQ(result->value().cloud_challenge.size(), 32u);
}

// ============================================================================
// Request Verification Tests
// ============================================================================

TEST_F(FirebaseClientTest, StartSession_SendsRequest) {
  auto client = CreateClient();

  std::optional<pw::Result<StartSessionResponse>> result;

  pw::async2::CoroContext coro_cx(test_allocator_);
  auto test_coro = [&](pw::async2::CoroContext& cx)
      -> pw::async2::Coro<pw::Status> {
    TagUid tag_uid;
    tag_uid.value = pw::bytes::Array<0x04, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66>();

    result = co_await client.StartSession(cx, tag_uid);
    co_return pw::OkStatus();
  };

  auto coro = test_coro(coro_cx);
  pw::async2::CoroOrElseTask task(
      std::move(coro), [](pw::Status) { /* Error handler */ });

  dispatcher_.Post(task);
  dispatcher_.RunUntilStalled();

  // Verify the request was sent
  EXPECT_EQ(rpc_ctx_.output().total_packets(), 1u);

  // Send response to complete the test cleanly
  std::array<std::byte, 256> payload_buffer;
  auto encode_result = EncodeAuthRequiredResponse(payload_buffer);
  ASSERT_TRUE(encode_result.ok());

  SendForwardResponse(
      pw::ConstByteSpan(payload_buffer.data(), *encode_result));

  ASSERT_TRUE(RunUntilComplete(task));
}

// ============================================================================
// Concurrent Call Tests
// ============================================================================

TEST_F(FirebaseClientTest, StartSession_ConcurrentCallReturnsUnavailable) {
  auto client = CreateClient();

  // Storage for results from both calls
  std::optional<pw::Result<StartSessionResponse>> result1;
  std::optional<pw::Result<StartSessionResponse>> result2;

  // First coroutine - starts the call
  pw::async2::CoroContext coro_cx1(test_allocator_);
  auto test_coro1 = [&](pw::async2::CoroContext& cx)
      -> pw::async2::Coro<pw::Status> {
    TagUid tag_uid;
    tag_uid.value = pw::bytes::Array<0x04, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66>();
    result1 = co_await client.StartSession(cx, tag_uid);
    co_return pw::OkStatus();
  };

  // Second coroutine - tries to start while first is in flight
  pw::async2::CoroContext coro_cx2(test_allocator_);
  auto test_coro2 = [&](pw::async2::CoroContext& cx)
      -> pw::async2::Coro<pw::Status> {
    TagUid tag_uid;
    tag_uid.value = pw::bytes::Array<0x04, 0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF>();
    result2 = co_await client.StartSession(cx, tag_uid);
    co_return pw::OkStatus();
  };

  auto coro1 = test_coro1(coro_cx1);
  pw::async2::CoroOrElseTask task1(
      std::move(coro1), [](pw::Status) { /* Error handler */ });

  auto coro2 = test_coro2(coro_cx2);
  pw::async2::CoroOrElseTask task2(
      std::move(coro2), [](pw::Status) { /* Error handler */ });

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
  auto encode_result = EncodeAuthRequiredResponse(payload_buffer);
  ASSERT_TRUE(encode_result.ok());
  SendForwardResponse(
      pw::ConstByteSpan(payload_buffer.data(), *encode_result));

  ASSERT_TRUE(RunUntilComplete(task1));
  ASSERT_TRUE(result1.has_value());
  EXPECT_TRUE(result1->ok());
}

}  // namespace
}  // namespace maco::firebase
