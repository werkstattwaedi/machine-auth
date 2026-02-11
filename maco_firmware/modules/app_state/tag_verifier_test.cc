// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/modules/app_state/tag_verifier.h"

#include <array>

#include "gtest/gtest.h"
#include "maco_firmware/modules/app_state/app_state.h"
#include "maco_firmware/modules/device_secrets/device_secrets_mock.h"
#include "maco_firmware/modules/nfc_reader/mock/mock_nfc_reader.h"
#include "maco_firmware/modules/nfc_tag/iso14443_tag_mock.h"
#include "maco_firmware/modules/nfc_tag/ntag424/ntag424_tag_mock.h"
#include "pw_allocator/testing.h"
#include "pw_async2/basic_dispatcher.h"
#include "pw_bytes/array.h"
#include "pw_random/xor_shift.h"

namespace maco::app_state {
namespace {

// Anti-collision UID (random, not the real UID)
constexpr auto kAntiCollisionUid =
    pw::bytes::Array<0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF, 0x01>();

// Real card UID (returned by GetCardUid after auth)
constexpr auto kRealUid =
    pw::bytes::Array<0x04, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66>();

// Default terminal key from DeviceSecretsMock (0x10..0x1F)
constexpr auto kTerminalKey = pw::bytes::Array<
    0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17,
    0x18, 0x19, 0x1A, 0x1B, 0x1C, 0x1D, 0x1E, 0x1F>();

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
  // Key slot 2 is the terminal key
  std::copy(terminal_key.begin(), terminal_key.end(), config.keys[2].begin());
  return config;
}

class TagVerifierTest : public ::testing::Test {
 protected:
  void SetUp() override {
    verifier_.emplace(reader_, app_state_, device_secrets_, rng_,
                      test_allocator_);
    verifier_->Start(dispatcher_);
    // Let the coroutine start and reach SubscribeOnce
    dispatcher_.RunUntilStalled();
  }

  void TearDown() override { verifier_.reset(); }

  AppStateSnapshot GetSnapshot() {
    AppStateSnapshot snapshot;
    app_state_.GetSnapshot(snapshot);
    return snapshot;
  }

  pw::async2::BasicDispatcher dispatcher_;
  pw::allocator::test::AllocatorForTest<4096> test_allocator_;
  nfc::MockNfcReader reader_;
  AppState app_state_;
  secrets::DeviceSecretsMock device_secrets_;
  pw::random::XorShiftStarRng64 rng_{0x12345678};
  std::optional<TagVerifier> verifier_;
};

// ============================================================================
// Happy Path: NTAG424 tag with correct terminal key
// ============================================================================

TEST_F(TagVerifierTest, HappyPath) {
  auto config = MakeConfig(kRealUid, kTerminalKey);

  // Use a separate RNG for the mock tag
  pw::random::XorShiftStarRng64 tag_rng{0xABCDEF01};
  auto tag = std::make_shared<nfc::Ntag424TagMock>(
      kAntiCollisionUid, kNtag424Sak, config, tag_rng);

  reader_.SimulateTagArrival(std::static_pointer_cast<nfc::MockTag>(tag));
  dispatcher_.RunUntilStalled();

  auto snapshot = GetSnapshot();
  EXPECT_EQ(snapshot.state, AppStateId::kGenuine);

  // Verify the real UID was read correctly
  ASSERT_EQ(snapshot.ntag_uid.size, 7u);
  EXPECT_TRUE(std::equal(kRealUid.begin(), kRealUid.end(),
                         snapshot.ntag_uid.bytes.begin()));
}

// ============================================================================
// Non-ISO tag → kUnknownTag
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

  // Create a simple ISO tag that responds with an error to SelectApp
  auto tag = std::make_shared<nfc::Iso14443TagMock>(uid, kNtag424Sak);
  // The Iso14443TagMock returns empty (0 bytes) by default for any command,
  // which will cause SelectApplication to fail with DataLoss (< 2 bytes)

  reader_.SimulateTagArrival(std::static_pointer_cast<nfc::MockTag>(tag));
  dispatcher_.RunUntilStalled();

  EXPECT_EQ(GetSnapshot().state, AppStateId::kUnknownTag);
}

// ============================================================================
// Auth fails (wrong key on tag) → kUnknownTag
// ============================================================================

TEST_F(TagVerifierTest, AuthFails) {
  // Tag has wrong key in slot 2 — auth will fail
  auto config = MakeConfig(kRealUid, kWrongKey);

  pw::random::XorShiftStarRng64 tag_rng{0xABCDEF01};
  auto tag = std::make_shared<nfc::Ntag424TagMock>(
      kAntiCollisionUid, kNtag424Sak, config, tag_rng);

  reader_.SimulateTagArrival(std::static_pointer_cast<nfc::MockTag>(tag));
  dispatcher_.RunUntilStalled();

  EXPECT_EQ(GetSnapshot().state, AppStateId::kUnknownTag);
}

// ============================================================================
// Tag departure → kIdle
// ============================================================================

TEST_F(TagVerifierTest, TagDeparture) {
  auto config = MakeConfig(kRealUid, kTerminalKey);

  pw::random::XorShiftStarRng64 tag_rng{0xABCDEF01};
  auto tag = std::make_shared<nfc::Ntag424TagMock>(
      kAntiCollisionUid, kNtag424Sak, config, tag_rng);

  reader_.SimulateTagArrival(std::static_pointer_cast<nfc::MockTag>(tag));
  dispatcher_.RunUntilStalled();
  ASSERT_EQ(GetSnapshot().state, AppStateId::kGenuine);

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

  // SelectApp succeeds but auth fails because terminal key is unavailable
  EXPECT_EQ(GetSnapshot().state, AppStateId::kUnknownTag);
}

}  // namespace
}  // namespace maco::app_state
