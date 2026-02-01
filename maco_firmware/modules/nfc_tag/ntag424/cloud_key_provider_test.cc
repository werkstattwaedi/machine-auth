// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/// @file cloud_key_provider_test.cc
/// @brief Unit tests for CloudKeyProvider.

#include "maco_firmware/modules/nfc_tag/ntag424/cloud_key_provider.h"

#include <optional>
#include <variant>

#include "firebase/firebase_client.h"
#include "firebase_rpc/auth.pwpb.h"
#include "gateway/gateway_service.pwpb.h"
#include "gateway/gateway_service.rpc.pwpb.h"
#include "pw_allocator/testing.h"
#include "pw_async2/basic_dispatcher.h"
#include "pw_async2/coro_or_else_task.h"
#include "pw_bytes/array.h"
#include "pw_rpc/pwpb/client_testing.h"
#include "pw_unit_test/framework.h"

namespace maco::nfc {
namespace {

using GatewayService = maco::gateway::pw_rpc::pwpb::GatewayService;

constexpr size_t kAllocatorSize = 4096;

// Test data
constexpr auto kTagUid =
    pw::bytes::Array<0x04, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66>();
constexpr auto kEncryptedRndB =
    pw::bytes::Array<0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A,
                     0x0B, 0x0C, 0x0D, 0x0E, 0x0F, 0x10>();
constexpr auto kCloudChallenge = pw::bytes::Array<
    0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF, 0x11, 0x22, 0x33, 0x44, 0x55,
    0x66, 0x77, 0x88, 0x99, 0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66,
    0x77, 0x88, 0x99, 0x00, 0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF>();
constexpr auto kEncryptedPart3 = pw::bytes::Array<
    0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0B,
    0x0C, 0x0D, 0x0E, 0x0F, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16,
    0x17, 0x18, 0x19, 0x1A, 0x1B, 0x1C, 0x1D, 0x1E, 0x1F, 0x20>();
constexpr auto kEncKey =
    pw::bytes::Array<0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xAA,
                     0xBB, 0xCC, 0xDD, 0xEE, 0xFF, 0x00>();
constexpr auto kMacKey =
    pw::bytes::Array<0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF, 0x00, 0x11, 0x22, 0x33,
                     0x44, 0x55, 0x66, 0x77, 0x88, 0x99>();
constexpr auto kTi = pw::bytes::Array<0x01, 0x02, 0x03, 0x04>();
constexpr auto kPiccCap =
    pw::bytes::Array<0x05, 0x06, 0x07, 0x08, 0x09, 0x0A>();

// Helper to encode an AuthenticateTagResponse
pw::Result<size_t> EncodeAuthenticateTagResponse(
    const char* auth_id,
    pw::ConstByteSpan cloud_challenge,
    pw::ByteSpan buffer) {
  maco::proto::firebase_rpc::pwpb::AuthenticateTagResponse::MemoryEncoder
      encoder(buffer);

  auto status = encoder.WriteAuthIdMessage(
      [auth_id](maco::proto::pwpb::FirebaseId::StreamEncoder& id_encoder) {
        return id_encoder.WriteValue(auth_id);
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

// Helper to encode a CompleteTagAuthResponse with session keys
pw::Result<size_t> EncodeCompleteTagAuthResponse(pw::ConstByteSpan enc_key,
                                                 pw::ConstByteSpan mac_key,
                                                 pw::ConstByteSpan ti,
                                                 pw::ConstByteSpan picc_cap,
                                                 pw::ByteSpan buffer) {
  maco::proto::firebase_rpc::pwpb::CompleteTagAuthResponse::MemoryEncoder
      encoder(buffer);

  auto status = encoder.WriteSessionKeysMessage(
      [&](maco::proto::firebase_rpc::pwpb::SessionKeys::StreamEncoder& keys) {
        auto st = keys.WriteSesAuthEncKey(enc_key);
        if (!st.ok()) return st;
        st = keys.WriteSesAuthMacKey(mac_key);
        if (!st.ok()) return st;
        st = keys.WriteTransactionIdentifier(ti);
        if (!st.ok()) return st;
        return keys.WritePiccCapabilities(picc_cap);
      });
  if (!status.ok()) {
    return status;
  }
  return encoder.size();
}

// Helper to encode a rejected CompleteTagAuthResponse
pw::Result<size_t> EncodeCompleteTagAuthRejected(const char* message,
                                                 pw::ByteSpan buffer) {
  maco::proto::firebase_rpc::pwpb::CompleteTagAuthResponse::MemoryEncoder
      encoder(buffer);

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

class CloudKeyProviderTest : public ::testing::Test {
 protected:
  firebase::FirebaseClient CreateFirebaseClient() {
    return firebase::FirebaseClient(rpc_ctx_.client(), rpc_ctx_.channel().id());
  }

  firebase::TagUid CreateTagUid() {
    firebase::TagUid tag_uid;
    tag_uid.value = kTagUid;
    return tag_uid;
  }

  void SendForwardResponse(pw::ConstByteSpan payload) {
    maco::gateway::pwpb::ForwardResponse::Message response;
    response.success = true;
    response.http_status = 200;
    response.payload.assign(payload.begin(), payload.end());

    rpc_ctx_.server().SendResponse<GatewayService::Forward>(response,
                                                            pw::OkStatus());
  }

  void SendRpcError(pw::Status status) {
    rpc_ctx_.server().SendServerError<GatewayService::Forward>(status);
  }

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
// CreateNtagChallenge Tests
// ============================================================================

TEST_F(CloudKeyProviderTest, CreateNtagChallenge_Success) {
  auto firebase_client = CreateFirebaseClient();
  auto tag_uid = CreateTagUid();
  CloudKeyProvider provider(firebase_client, tag_uid, /*key_number=*/0);

  std::optional<pw::Result<std::array<std::byte, 32>>> result;

  pw::async2::CoroContext coro_cx(test_allocator_);
  auto test_coro =
      [&](pw::async2::CoroContext& cx) -> pw::async2::Coro<pw::Status> {
    result = co_await provider.CreateNtagChallenge(cx, kEncryptedRndB);
    co_return pw::OkStatus();
  };

  auto coro = test_coro(coro_cx);
  pw::async2::CoroOrElseTask task(std::move(coro),
                                  [](pw::Status) { /* Error handler */ });

  dispatcher_.Post(task);
  dispatcher_.RunUntilStalled();

  // Inject success response
  std::array<std::byte, 256> payload_buffer;
  auto encode_result =
      EncodeAuthenticateTagResponse("auth123", kCloudChallenge, payload_buffer);
  ASSERT_TRUE(encode_result.ok());

  SendForwardResponse(
      pw::ConstByteSpan(payload_buffer.data(), *encode_result));

  ASSERT_TRUE(RunUntilComplete(task));

  ASSERT_TRUE(result.has_value());
  ASSERT_TRUE(result->ok());
  EXPECT_EQ(result->value().size(), 32u);

  // Verify auth_id is stored
  ASSERT_TRUE(provider.auth_id().has_value());
  EXPECT_EQ(std::string_view(provider.auth_id()->value.c_str()), "auth123");
}

TEST_F(CloudKeyProviderTest, CreateNtagChallenge_InvalidInputSize) {
  auto firebase_client = CreateFirebaseClient();
  auto tag_uid = CreateTagUid();
  CloudKeyProvider provider(firebase_client, tag_uid, /*key_number=*/0);

  std::optional<pw::Result<std::array<std::byte, 32>>> result;

  pw::async2::CoroContext coro_cx(test_allocator_);
  auto test_coro =
      [&](pw::async2::CoroContext& cx) -> pw::async2::Coro<pw::Status> {
    // Wrong size - only 8 bytes instead of 16
    auto wrong_size = pw::bytes::Array<0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
                                       0x08>();
    result = co_await provider.CreateNtagChallenge(cx, wrong_size);
    co_return pw::OkStatus();
  };

  auto coro = test_coro(coro_cx);
  pw::async2::CoroOrElseTask task(std::move(coro),
                                  [](pw::Status) { /* Error handler */ });

  dispatcher_.Post(task);
  ASSERT_TRUE(RunUntilComplete(task));

  ASSERT_TRUE(result.has_value());
  EXPECT_FALSE(result->ok());
  EXPECT_EQ(result->status(), pw::Status::InvalidArgument());
}

TEST_F(CloudKeyProviderTest, CreateNtagChallenge_RpcFailure) {
  auto firebase_client = CreateFirebaseClient();
  auto tag_uid = CreateTagUid();
  CloudKeyProvider provider(firebase_client, tag_uid, /*key_number=*/0);

  std::optional<pw::Result<std::array<std::byte, 32>>> result;

  pw::async2::CoroContext coro_cx(test_allocator_);
  auto test_coro =
      [&](pw::async2::CoroContext& cx) -> pw::async2::Coro<pw::Status> {
    result = co_await provider.CreateNtagChallenge(cx, kEncryptedRndB);
    co_return pw::OkStatus();
  };

  auto coro = test_coro(coro_cx);
  pw::async2::CoroOrElseTask task(std::move(coro),
                                  [](pw::Status) { /* Error handler */ });

  dispatcher_.Post(task);
  dispatcher_.RunUntilStalled();

  // Inject RPC error
  SendRpcError(pw::Status::Unavailable());

  ASSERT_TRUE(RunUntilComplete(task));

  ASSERT_TRUE(result.has_value());
  EXPECT_FALSE(result->ok());
  EXPECT_EQ(result->status(), pw::Status::Unavailable());
}

// ============================================================================
// VerifyAndComputeSessionKeys Tests
// ============================================================================

TEST_F(CloudKeyProviderTest, VerifyAndComputeSessionKeys_Success) {
  auto firebase_client = CreateFirebaseClient();
  auto tag_uid = CreateTagUid();
  CloudKeyProvider provider(firebase_client, tag_uid, /*key_number=*/0);

  std::optional<pw::Result<std::array<std::byte, 32>>> challenge_result;
  std::optional<pw::Result<SessionKeys>> verify_result;

  pw::async2::CoroContext coro_cx(test_allocator_);
  auto test_coro =
      [&](pw::async2::CoroContext& cx) -> pw::async2::Coro<pw::Status> {
    // First call CreateNtagChallenge
    challenge_result = co_await provider.CreateNtagChallenge(cx, kEncryptedRndB);
    if (!challenge_result->ok()) {
      co_return challenge_result->status();
    }

    // Then call VerifyAndComputeSessionKeys
    verify_result =
        co_await provider.VerifyAndComputeSessionKeys(cx, kEncryptedPart3);
    co_return pw::OkStatus();
  };

  auto coro = test_coro(coro_cx);
  pw::async2::CoroOrElseTask task(std::move(coro),
                                  [](pw::Status) { /* Error handler */ });

  dispatcher_.Post(task);
  dispatcher_.RunUntilStalled();

  // Respond to AuthenticateTag
  std::array<std::byte, 256> payload_buffer;
  auto encode_result =
      EncodeAuthenticateTagResponse("auth123", kCloudChallenge, payload_buffer);
  ASSERT_TRUE(encode_result.ok());
  SendForwardResponse(
      pw::ConstByteSpan(payload_buffer.data(), *encode_result));

  dispatcher_.RunUntilStalled();

  // Respond to CompleteTagAuth
  encode_result = EncodeCompleteTagAuthResponse(kEncKey, kMacKey, kTi, kPiccCap,
                                                payload_buffer);
  ASSERT_TRUE(encode_result.ok());
  SendForwardResponse(
      pw::ConstByteSpan(payload_buffer.data(), *encode_result));

  ASSERT_TRUE(RunUntilComplete(task));

  // Verify challenge result
  ASSERT_TRUE(challenge_result.has_value());
  EXPECT_TRUE(challenge_result->ok());

  // Verify session keys result
  ASSERT_TRUE(verify_result.has_value());
  ASSERT_TRUE(verify_result->ok());

  const auto& keys = verify_result->value();
  EXPECT_EQ(keys.ses_auth_enc_key.size(), 16u);
  EXPECT_EQ(keys.ses_auth_mac_key.size(), 16u);
  EXPECT_EQ(keys.transaction_identifier.size(), 4u);
  EXPECT_EQ(keys.picc_capabilities.size(), 6u);

  // Verify auth_id is still available
  ASSERT_TRUE(provider.auth_id().has_value());
  EXPECT_EQ(std::string_view(provider.auth_id()->value.c_str()), "auth123");
}

TEST_F(CloudKeyProviderTest, VerifyAndComputeSessionKeys_Rejected) {
  auto firebase_client = CreateFirebaseClient();
  auto tag_uid = CreateTagUid();
  CloudKeyProvider provider(firebase_client, tag_uid, /*key_number=*/0);

  std::optional<pw::Result<std::array<std::byte, 32>>> challenge_result;
  std::optional<pw::Result<SessionKeys>> verify_result;

  pw::async2::CoroContext coro_cx(test_allocator_);
  auto test_coro =
      [&](pw::async2::CoroContext& cx) -> pw::async2::Coro<pw::Status> {
    challenge_result = co_await provider.CreateNtagChallenge(cx, kEncryptedRndB);
    if (!challenge_result->ok()) {
      co_return challenge_result->status();
    }
    verify_result =
        co_await provider.VerifyAndComputeSessionKeys(cx, kEncryptedPart3);
    co_return pw::OkStatus();
  };

  auto coro = test_coro(coro_cx);
  pw::async2::CoroOrElseTask task(std::move(coro),
                                  [](pw::Status) { /* Error handler */ });

  dispatcher_.Post(task);
  dispatcher_.RunUntilStalled();

  // Respond to AuthenticateTag
  std::array<std::byte, 256> payload_buffer;
  auto encode_result =
      EncodeAuthenticateTagResponse("auth123", kCloudChallenge, payload_buffer);
  ASSERT_TRUE(encode_result.ok());
  SendForwardResponse(
      pw::ConstByteSpan(payload_buffer.data(), *encode_result));

  dispatcher_.RunUntilStalled();

  // Respond to CompleteTagAuth with rejection
  encode_result =
      EncodeCompleteTagAuthRejected("Authentication failed", payload_buffer);
  ASSERT_TRUE(encode_result.ok());
  SendForwardResponse(
      pw::ConstByteSpan(payload_buffer.data(), *encode_result));

  ASSERT_TRUE(RunUntilComplete(task));

  ASSERT_TRUE(verify_result.has_value());
  EXPECT_FALSE(verify_result->ok());
  EXPECT_EQ(verify_result->status(), pw::Status::Unauthenticated());

  // Verify auth_id is cleared on rejection
  EXPECT_FALSE(provider.auth_id().has_value());
}

TEST_F(CloudKeyProviderTest, VerifyAndComputeSessionKeys_NoAuthId) {
  auto firebase_client = CreateFirebaseClient();
  auto tag_uid = CreateTagUid();
  CloudKeyProvider provider(firebase_client, tag_uid, /*key_number=*/0);

  std::optional<pw::Result<SessionKeys>> result;

  pw::async2::CoroContext coro_cx(test_allocator_);
  auto test_coro =
      [&](pw::async2::CoroContext& cx) -> pw::async2::Coro<pw::Status> {
    // Call VerifyAndComputeSessionKeys without calling CreateNtagChallenge first
    result =
        co_await provider.VerifyAndComputeSessionKeys(cx, kEncryptedPart3);
    co_return pw::OkStatus();
  };

  auto coro = test_coro(coro_cx);
  pw::async2::CoroOrElseTask task(std::move(coro),
                                  [](pw::Status) { /* Error handler */ });

  dispatcher_.Post(task);
  ASSERT_TRUE(RunUntilComplete(task));

  ASSERT_TRUE(result.has_value());
  EXPECT_FALSE(result->ok());
  EXPECT_EQ(result->status(), pw::Status::FailedPrecondition());
}

TEST_F(CloudKeyProviderTest, VerifyAndComputeSessionKeys_InvalidInputSize) {
  auto firebase_client = CreateFirebaseClient();
  auto tag_uid = CreateTagUid();
  CloudKeyProvider provider(firebase_client, tag_uid, /*key_number=*/0);

  // Manually set auth_id to skip CreateNtagChallenge
  // (We can't do this directly, so we need to go through the full flow)
  std::optional<pw::Result<std::array<std::byte, 32>>> challenge_result;
  std::optional<pw::Result<SessionKeys>> verify_result;

  pw::async2::CoroContext coro_cx(test_allocator_);
  auto test_coro =
      [&](pw::async2::CoroContext& cx) -> pw::async2::Coro<pw::Status> {
    challenge_result = co_await provider.CreateNtagChallenge(cx, kEncryptedRndB);
    if (!challenge_result->ok()) {
      co_return challenge_result->status();
    }

    // Call with wrong size - only 16 bytes instead of 32
    auto wrong_size = pw::bytes::Array<0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
                                       0x08, 0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x0E,
                                       0x0F, 0x10>();
    verify_result = co_await provider.VerifyAndComputeSessionKeys(cx, wrong_size);
    co_return pw::OkStatus();
  };

  auto coro = test_coro(coro_cx);
  pw::async2::CoroOrElseTask task(std::move(coro),
                                  [](pw::Status) { /* Error handler */ });

  dispatcher_.Post(task);
  dispatcher_.RunUntilStalled();

  // Respond to AuthenticateTag
  std::array<std::byte, 256> payload_buffer;
  auto encode_result =
      EncodeAuthenticateTagResponse("auth123", kCloudChallenge, payload_buffer);
  ASSERT_TRUE(encode_result.ok());
  SendForwardResponse(
      pw::ConstByteSpan(payload_buffer.data(), *encode_result));

  ASSERT_TRUE(RunUntilComplete(task));

  ASSERT_TRUE(verify_result.has_value());
  EXPECT_FALSE(verify_result->ok());
  EXPECT_EQ(verify_result->status(), pw::Status::InvalidArgument());
}

// ============================================================================
// CancelAuthentication Tests
// ============================================================================

TEST_F(CloudKeyProviderTest, CancelAuthentication_ClearsState) {
  auto firebase_client = CreateFirebaseClient();
  auto tag_uid = CreateTagUid();
  CloudKeyProvider provider(firebase_client, tag_uid, /*key_number=*/0);

  std::optional<pw::Result<std::array<std::byte, 32>>> result;

  pw::async2::CoroContext coro_cx(test_allocator_);
  auto test_coro =
      [&](pw::async2::CoroContext& cx) -> pw::async2::Coro<pw::Status> {
    result = co_await provider.CreateNtagChallenge(cx, kEncryptedRndB);
    co_return pw::OkStatus();
  };

  auto coro = test_coro(coro_cx);
  pw::async2::CoroOrElseTask task(std::move(coro),
                                  [](pw::Status) { /* Error handler */ });

  dispatcher_.Post(task);
  dispatcher_.RunUntilStalled();

  // Respond to AuthenticateTag
  std::array<std::byte, 256> payload_buffer;
  auto encode_result =
      EncodeAuthenticateTagResponse("auth123", kCloudChallenge, payload_buffer);
  ASSERT_TRUE(encode_result.ok());
  SendForwardResponse(
      pw::ConstByteSpan(payload_buffer.data(), *encode_result));

  ASSERT_TRUE(RunUntilComplete(task));

  // Verify auth_id is set
  ASSERT_TRUE(provider.auth_id().has_value());

  // Cancel authentication
  provider.CancelAuthentication();

  // Verify auth_id is cleared
  EXPECT_FALSE(provider.auth_id().has_value());
}

// ============================================================================
// auth_id Tests
// ============================================================================

TEST_F(CloudKeyProviderTest, AuthId_AvailableAfterSuccess) {
  auto firebase_client = CreateFirebaseClient();
  auto tag_uid = CreateTagUid();
  CloudKeyProvider provider(firebase_client, tag_uid, /*key_number=*/0);

  std::optional<pw::Result<std::array<std::byte, 32>>> challenge_result;
  std::optional<pw::Result<SessionKeys>> verify_result;

  pw::async2::CoroContext coro_cx(test_allocator_);
  auto test_coro =
      [&](pw::async2::CoroContext& cx) -> pw::async2::Coro<pw::Status> {
    challenge_result = co_await provider.CreateNtagChallenge(cx, kEncryptedRndB);
    if (!challenge_result->ok()) {
      co_return challenge_result->status();
    }
    verify_result =
        co_await provider.VerifyAndComputeSessionKeys(cx, kEncryptedPart3);
    co_return pw::OkStatus();
  };

  auto coro = test_coro(coro_cx);
  pw::async2::CoroOrElseTask task(std::move(coro),
                                  [](pw::Status) { /* Error handler */ });

  dispatcher_.Post(task);
  dispatcher_.RunUntilStalled();

  // Respond to AuthenticateTag
  std::array<std::byte, 256> payload_buffer;
  auto encode_result =
      EncodeAuthenticateTagResponse("my_auth_id_xyz", kCloudChallenge, payload_buffer);
  ASSERT_TRUE(encode_result.ok());
  SendForwardResponse(
      pw::ConstByteSpan(payload_buffer.data(), *encode_result));

  dispatcher_.RunUntilStalled();

  // Respond to CompleteTagAuth
  encode_result = EncodeCompleteTagAuthResponse(kEncKey, kMacKey, kTi, kPiccCap,
                                                payload_buffer);
  ASSERT_TRUE(encode_result.ok());
  SendForwardResponse(
      pw::ConstByteSpan(payload_buffer.data(), *encode_result));

  ASSERT_TRUE(RunUntilComplete(task));

  // Verify auth_id is available and correct
  ASSERT_TRUE(provider.auth_id().has_value());
  EXPECT_EQ(std::string_view(provider.auth_id()->value.c_str()), "my_auth_id_xyz");
}

TEST_F(CloudKeyProviderTest, AuthId_ClearedOnRejection) {
  // This is already tested in VerifyAndComputeSessionKeys_Rejected,
  // but we include a focused test for clarity
  auto firebase_client = CreateFirebaseClient();
  auto tag_uid = CreateTagUid();
  CloudKeyProvider provider(firebase_client, tag_uid, /*key_number=*/0);

  std::optional<pw::Result<std::array<std::byte, 32>>> challenge_result;
  std::optional<pw::Result<SessionKeys>> verify_result;

  pw::async2::CoroContext coro_cx(test_allocator_);
  auto test_coro =
      [&](pw::async2::CoroContext& cx) -> pw::async2::Coro<pw::Status> {
    challenge_result = co_await provider.CreateNtagChallenge(cx, kEncryptedRndB);
    if (!challenge_result->ok()) {
      co_return challenge_result->status();
    }
    verify_result =
        co_await provider.VerifyAndComputeSessionKeys(cx, kEncryptedPart3);
    co_return pw::OkStatus();
  };

  auto coro = test_coro(coro_cx);
  pw::async2::CoroOrElseTask task(std::move(coro),
                                  [](pw::Status) { /* Error handler */ });

  dispatcher_.Post(task);
  dispatcher_.RunUntilStalled();

  // Respond to AuthenticateTag - auth_id should be set after this
  std::array<std::byte, 256> payload_buffer;
  auto encode_result =
      EncodeAuthenticateTagResponse("auth_to_be_cleared", kCloudChallenge, payload_buffer);
  ASSERT_TRUE(encode_result.ok());
  SendForwardResponse(
      pw::ConstByteSpan(payload_buffer.data(), *encode_result));

  dispatcher_.RunUntilStalled();

  // At this point auth_id should be set
  ASSERT_TRUE(provider.auth_id().has_value());

  // Respond to CompleteTagAuth with rejection
  encode_result = EncodeCompleteTagAuthRejected("Rejected", payload_buffer);
  ASSERT_TRUE(encode_result.ok());
  SendForwardResponse(
      pw::ConstByteSpan(payload_buffer.data(), *encode_result));

  ASSERT_TRUE(RunUntilComplete(task));

  // Verify auth_id is cleared after rejection
  EXPECT_FALSE(provider.auth_id().has_value());
}

// ============================================================================
// KeyNumber Tests
// ============================================================================

TEST_F(CloudKeyProviderTest, KeyNumber_ReturnsCorrectValue) {
  auto firebase_client = CreateFirebaseClient();
  auto tag_uid = CreateTagUid();

  CloudKeyProvider provider0(firebase_client, tag_uid, /*key_number=*/0);
  EXPECT_EQ(provider0.key_number(), 0u);

  CloudKeyProvider provider1(firebase_client, tag_uid, /*key_number=*/1);
  EXPECT_EQ(provider1.key_number(), 1u);

  CloudKeyProvider provider4(firebase_client, tag_uid, /*key_number=*/4);
  EXPECT_EQ(provider4.key_number(), 4u);
}

}  // namespace
}  // namespace maco::nfc
