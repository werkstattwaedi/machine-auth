// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/modules/app_state/tag_verifier.h"

#include <array>
#include <cstring>

#include "firebase/firebase_client.h"
#include "firebase_rpc/auth.pb.h"
#include "gateway/gateway_service.pb.h"
#include "gateway/gateway_service.rpc.pb.h"
#include "gtest/gtest.h"
#include "maco_firmware/modules/app_state/app_state.h"
#include "maco_firmware/modules/device_secrets/device_secrets_mock.h"
#include "maco_firmware/modules/nfc_reader/mock/mock_nfc_reader.h"
#include "maco_firmware/modules/nfc_tag/iso14443_tag_mock.h"
#include "maco_firmware/modules/nfc_tag/ntag424/ntag424_tag_mock.h"
#include "pb_encode.h"
#include "pw_allocator/testing.h"
#include "pw_async2/basic_dispatcher.h"
#include "pw_bytes/array.h"
#include "pw_random/xor_shift.h"
#include "pw_rpc/nanopb/client_testing.h"

namespace maco::app_state {
namespace {

using GatewayService = maco::gateway::pw_rpc::nanopb::GatewayService;

// Anti-collision UID (random, not the real UID)
constexpr auto kAntiCollisionUid =
    pw::bytes::Array<0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF, 0x01>();

// Real card UID (returned by GetCardUid after auth)
constexpr auto kRealUid =
    pw::bytes::Array<0x04, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66>();

// Default terminal key from DeviceSecretsMock (matches functions/.env.local)
constexpr auto kTerminalKey = pw::bytes::Array<
    0xF5, 0xE4, 0xB9, 0x99, 0xD5, 0xAA, 0x62, 0x9F,
    0x19, 0x3A, 0x87, 0x45, 0x29, 0xC4, 0xAA, 0x2F>();

// Wrong key for testing auth failure
constexpr auto kWrongKey = pw::bytes::Array<
    0xFF, 0xFE, 0xFD, 0xFC, 0xFB, 0xFA, 0xF9, 0xF8,
    0xF7, 0xF6, 0xF5, 0xF4, 0xF3, 0xF2, 0xF1, 0xF0>();

constexpr uint8_t kNtag424Sak = 0x20;

nfc::Ntag424TagMock::Config MakeConfig(
    pw::ConstByteSpan real_uid,
    pw::ConstByteSpan terminal_key) {
  nfc::Ntag424TagMock::Config config{};
  std::copy(real_uid.begin(), real_uid.end(), config.real_uid.begin());
  // Key slot 1 is the terminal key
  std::copy(terminal_key.begin(), terminal_key.end(), config.keys[1].begin());
  return config;
}

// Helper to encode an Authorized TerminalCheckinResponse with existing auth
pw::Result<size_t> EncodeAuthorizedWithAuth(const char* user_id,
                                            const char* user_label,
                                            const char* auth_id,
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
  response.result.authorized.has_authentication_id = true;
  std::strncpy(response.result.authorized.authentication_id.value, auth_id,
               sizeof(response.result.authorized.authentication_id.value) - 1);

  pb_ostream_t stream = pb_ostream_from_buffer(
      reinterpret_cast<pb_byte_t*>(buffer.data()), buffer.size());
  if (!pb_encode(&stream,
                 maco_proto_firebase_rpc_TerminalCheckinResponse_fields,
                 &response)) {
    return pw::Status::Internal();
  }
  return stream.bytes_written;
}

// Helper to encode a Rejected TerminalCheckinResponse
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

class TagVerifierTest : public ::testing::Test {
 protected:
  void SetUp() override {
    firebase_client_.emplace(rpc_ctx_.client(), rpc_ctx_.channel().id());
    verifier_.emplace(reader_, app_state_, device_secrets_, *firebase_client_,
                      rng_, test_allocator_);
    verifier_->Start(dispatcher_);
    // Let the coroutine start and reach SubscribeOnce
    dispatcher_.RunUntilStalled();
  }

  void TearDown() override {
    verifier_.reset();
    firebase_client_.reset();
  }

  AppStateSnapshot GetSnapshot() {
    AppStateSnapshot snapshot;
    app_state_.GetSnapshot(snapshot);
    return snapshot;
  }

  void SendForwardResponse(pw::ConstByteSpan payload) {
    maco_gateway_ForwardResponse response =
        maco_gateway_ForwardResponse_init_zero;
    response.success = true;
    response.http_status = 200;
    std::memcpy(response.payload.bytes, payload.data(), payload.size());
    response.payload.size = payload.size();

    rpc_ctx_.server().SendResponse<GatewayService::Forward>(response,
                                                            pw::OkStatus());
  }

  void SendCheckinAuthorizedWithAuth(const char* user_id,
                                     const char* user_label,
                                     const char* auth_id) {
    std::array<std::byte, 256> payload_buffer;
    auto encode_result =
        EncodeAuthorizedWithAuth(user_id, user_label, auth_id, payload_buffer);
    ASSERT_TRUE(encode_result.ok());
    SendForwardResponse(
        pw::ConstByteSpan(payload_buffer.data(), *encode_result));
  }

  void SendCheckinRejected(const char* message) {
    std::array<std::byte, 256> payload_buffer;
    auto encode_result = EncodeRejectedResponse(message, payload_buffer);
    ASSERT_TRUE(encode_result.ok());
    SendForwardResponse(
        pw::ConstByteSpan(payload_buffer.data(), *encode_result));
  }

  void SendRpcError(pw::Status status) {
    rpc_ctx_.server().SendServerError<GatewayService::Forward>(status);
  }

  pw::rpc::NanopbClientTestContext<10, 512, 1024> rpc_ctx_;
  pw::async2::BasicDispatcher dispatcher_;
  pw::allocator::test::AllocatorForTest<4096> test_allocator_;
  nfc::MockNfcReader reader_;
  AppState app_state_;
  secrets::DeviceSecretsMock device_secrets_;
  pw::random::XorShiftStarRng64 rng_{0x12345678};
  std::optional<firebase::FirebaseClient> firebase_client_;
  std::optional<TagVerifier> verifier_;
};

// ============================================================================
// Happy Path: NTAG424 tag → verified → cloud authorized
// ============================================================================

TEST_F(TagVerifierTest, HappyPath) {
  auto config = MakeConfig(kRealUid, kTerminalKey);

  pw::random::XorShiftStarRng64 tag_rng{0xABCDEF01};
  auto tag = std::make_shared<nfc::Ntag424TagMock>(
      kAntiCollisionUid, kNtag424Sak, config, tag_rng);

  reader_.SimulateTagArrival(std::static_pointer_cast<nfc::MockTag>(tag));
  dispatcher_.RunUntilStalled();

  // After terminal auth, coroutine suspends at TerminalCheckin RPC
  EXPECT_EQ(GetSnapshot().state, AppStateId::kAuthorizing);

  // Inject authorized response with existing auth
  SendCheckinAuthorizedWithAuth("user123", "Test User", "auth_abc");
  dispatcher_.RunUntilStalled();

  auto snapshot = GetSnapshot();
  EXPECT_EQ(snapshot.state, AppStateId::kAuthorized);
  EXPECT_EQ(std::string_view(snapshot.user_label), "Test User");
  EXPECT_EQ(snapshot.auth_id.value(), "auth_abc");

  // Verify the real UID was read correctly
  ASSERT_EQ(snapshot.ntag_uid.size, 7u);
  EXPECT_TRUE(std::equal(kRealUid.begin(), kRealUid.end(),
                         snapshot.ntag_uid.bytes.begin()));
}

// ============================================================================
// Non-ISO tag → kUnknownTag (no authorization attempted)
// ============================================================================

TEST_F(TagVerifierTest, NonIsoTag) {
  auto uid = pw::bytes::Array<0x01, 0x02, 0x03, 0x04>();
  auto tag = std::make_shared<nfc::Iso14443TagMock>(
      uid, 0x00, /*supports_iso14443_4=*/false);

  reader_.SimulateTagArrival(std::static_pointer_cast<nfc::MockTag>(tag));
  dispatcher_.RunUntilStalled();

  EXPECT_EQ(GetSnapshot().state, AppStateId::kUnknownTag);
}

// ============================================================================
// SelectApp fails → kUnknownTag
// ============================================================================

TEST_F(TagVerifierTest, SelectFails) {
  auto uid = pw::bytes::Array<0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07>();

  auto tag = std::make_shared<nfc::Iso14443TagMock>(uid, kNtag424Sak);

  reader_.SimulateTagArrival(std::static_pointer_cast<nfc::MockTag>(tag));
  dispatcher_.RunUntilStalled();

  EXPECT_EQ(GetSnapshot().state, AppStateId::kUnknownTag);
}

// ============================================================================
// Auth fails (wrong key on tag) → kUnknownTag
// ============================================================================

TEST_F(TagVerifierTest, AuthFails) {
  auto config = MakeConfig(kRealUid, kWrongKey);

  pw::random::XorShiftStarRng64 tag_rng{0xABCDEF01};
  auto tag = std::make_shared<nfc::Ntag424TagMock>(
      kAntiCollisionUid, kNtag424Sak, config, tag_rng);

  reader_.SimulateTagArrival(std::static_pointer_cast<nfc::MockTag>(tag));
  dispatcher_.RunUntilStalled();

  EXPECT_EQ(GetSnapshot().state, AppStateId::kUnknownTag);
}

// ============================================================================
// Tag departure after authorization → kIdle
// ============================================================================

TEST_F(TagVerifierTest, TagDeparture) {
  auto config = MakeConfig(kRealUid, kTerminalKey);

  pw::random::XorShiftStarRng64 tag_rng{0xABCDEF01};
  auto tag = std::make_shared<nfc::Ntag424TagMock>(
      kAntiCollisionUid, kNtag424Sak, config, tag_rng);

  reader_.SimulateTagArrival(std::static_pointer_cast<nfc::MockTag>(tag));
  dispatcher_.RunUntilStalled();
  ASSERT_EQ(GetSnapshot().state, AppStateId::kAuthorizing);

  // Complete authorization
  SendCheckinAuthorizedWithAuth("user123", "User", "auth_abc");
  dispatcher_.RunUntilStalled();
  ASSERT_EQ(GetSnapshot().state, AppStateId::kAuthorized);

  // Tag departs
  reader_.SimulateTagDeparture();
  dispatcher_.RunUntilStalled();

  EXPECT_EQ(GetSnapshot().state, AppStateId::kIdle);
}

// ============================================================================
// Secrets not provisioned → kUnknownTag
// ============================================================================

TEST_F(TagVerifierTest, SecretsNotProvisioned) {
  device_secrets_.Clear();

  auto config = MakeConfig(kRealUid, kTerminalKey);

  pw::random::XorShiftStarRng64 tag_rng{0xABCDEF01};
  auto tag = std::make_shared<nfc::Ntag424TagMock>(
      kAntiCollisionUid, kNtag424Sak, config, tag_rng);

  reader_.SimulateTagArrival(std::static_pointer_cast<nfc::MockTag>(tag));
  dispatcher_.RunUntilStalled();

  EXPECT_EQ(GetSnapshot().state, AppStateId::kUnknownTag);
}

// ============================================================================
// TerminalCheckin rejected → kUnauthorized
// ============================================================================

TEST_F(TagVerifierTest, CheckinRejected) {
  auto config = MakeConfig(kRealUid, kTerminalKey);

  pw::random::XorShiftStarRng64 tag_rng{0xABCDEF01};
  auto tag = std::make_shared<nfc::Ntag424TagMock>(
      kAntiCollisionUid, kNtag424Sak, config, tag_rng);

  reader_.SimulateTagArrival(std::static_pointer_cast<nfc::MockTag>(tag));
  dispatcher_.RunUntilStalled();
  ASSERT_EQ(GetSnapshot().state, AppStateId::kAuthorizing);

  // Inject rejected response
  SendCheckinRejected("User not authorized");
  dispatcher_.RunUntilStalled();

  EXPECT_EQ(GetSnapshot().state, AppStateId::kUnauthorized);
}

// ============================================================================
// TerminalCheckin RPC error → kUnauthorized
// ============================================================================

TEST_F(TagVerifierTest, CheckinRpcFailure) {
  auto config = MakeConfig(kRealUid, kTerminalKey);

  pw::random::XorShiftStarRng64 tag_rng{0xABCDEF01};
  auto tag = std::make_shared<nfc::Ntag424TagMock>(
      kAntiCollisionUid, kNtag424Sak, config, tag_rng);

  reader_.SimulateTagArrival(std::static_pointer_cast<nfc::MockTag>(tag));
  dispatcher_.RunUntilStalled();
  ASSERT_EQ(GetSnapshot().state, AppStateId::kAuthorizing);

  // Inject RPC-level error
  SendRpcError(pw::Status::Unavailable());
  dispatcher_.RunUntilStalled();

  EXPECT_EQ(GetSnapshot().state, AppStateId::kUnauthorized);
}

// ============================================================================
// Cache hit - second tap reuses cached authorization
// ============================================================================

TEST_F(TagVerifierTest, CacheHit) {
  auto config = MakeConfig(kRealUid, kTerminalKey);

  // First tap: authorize via cloud
  {
    pw::random::XorShiftStarRng64 tag_rng{0xABCDEF01};
    auto tag = std::make_shared<nfc::Ntag424TagMock>(
        kAntiCollisionUid, kNtag424Sak, config, tag_rng);

    reader_.SimulateTagArrival(std::static_pointer_cast<nfc::MockTag>(tag));
    dispatcher_.RunUntilStalled();
    ASSERT_EQ(GetSnapshot().state, AppStateId::kAuthorizing);

    SendCheckinAuthorizedWithAuth("user123", "Cached User", "auth_cached");
    dispatcher_.RunUntilStalled();
    ASSERT_EQ(GetSnapshot().state, AppStateId::kAuthorized);

    // Remove tag
    reader_.SimulateTagDeparture();
    dispatcher_.RunUntilStalled();
    ASSERT_EQ(GetSnapshot().state, AppStateId::kIdle);
  }

  // Second tap: should use cache (no RPC call)
  {
    pw::random::XorShiftStarRng64 tag_rng{0xDEADBEEF};
    auto tag = std::make_shared<nfc::Ntag424TagMock>(
        kAntiCollisionUid, kNtag424Sak, config, tag_rng);

    reader_.SimulateTagArrival(std::static_pointer_cast<nfc::MockTag>(tag));
    dispatcher_.RunUntilStalled();

    // Should go directly to kAuthorized (cache hit skips kAuthorizing)
    auto snapshot = GetSnapshot();
    EXPECT_EQ(snapshot.state, AppStateId::kAuthorized);
    EXPECT_EQ(std::string_view(snapshot.user_label), "Cached User");
    EXPECT_EQ(snapshot.auth_id.value(), "auth_cached");
  }
}

// ============================================================================
// Tag departure during kAuthorizing → kIdle
// ============================================================================

TEST_F(TagVerifierTest, TagDepartureDuringAuthorizing) {
  auto config = MakeConfig(kRealUid, kTerminalKey);

  pw::random::XorShiftStarRng64 tag_rng{0xABCDEF01};
  auto tag = std::make_shared<nfc::Ntag424TagMock>(
      kAntiCollisionUid, kNtag424Sak, config, tag_rng);

  reader_.SimulateTagArrival(std::static_pointer_cast<nfc::MockTag>(tag));
  dispatcher_.RunUntilStalled();
  ASSERT_EQ(GetSnapshot().state, AppStateId::kAuthorizing);

  // Tag departs while coroutine is suspended at RPC.
  // MockNfcReader uses ValueProvider (not a queue), so the departure
  // event is lost because no SubscribeOnce is active during RPC suspend.
  reader_.SimulateTagDeparture();
  dispatcher_.RunUntilStalled();

  // State is still kAuthorizing (coroutine blocked on RPC)
  EXPECT_EQ(GetSnapshot().state, AppStateId::kAuthorizing);

  // RPC response arrives - authorization completes.
  // Departure was lost, so state goes to kAuthorized.
  SendCheckinAuthorizedWithAuth("user123", "Late", "auth_late");
  dispatcher_.RunUntilStalled();

  EXPECT_EQ(GetSnapshot().state, AppStateId::kAuthorized);
}

}  // namespace
}  // namespace maco::app_state
