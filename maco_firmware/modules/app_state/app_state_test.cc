// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/modules/app_state/app_state.h"

#include "pw_bytes/array.h"
#include "pw_unit_test/framework.h"

namespace maco::app_state {
namespace {

TEST(AppStateTest, InitialStateIsIdle) {
  AppState state;
  AppStateSnapshot snapshot;

  state.GetSnapshot(snapshot);

  EXPECT_EQ(snapshot.state, AppStateId::kIdle);
  EXPECT_TRUE(snapshot.tag_uid.empty());
  EXPECT_TRUE(snapshot.ntag_uid.empty());
}

TEST(AppStateTest, OnTagDetectedTransitionsToTagDetected) {
  AppState state;
  AppStateSnapshot snapshot;

  constexpr auto kTestUid =
      pw::bytes::Array<0x04, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66>();
  state.OnTagDetected(kTestUid);
  state.GetSnapshot(snapshot);

  EXPECT_EQ(snapshot.state, AppStateId::kTagDetected);
  EXPECT_EQ(snapshot.tag_uid.size, kTestUid.size());
  for (size_t i = 0; i < kTestUid.size(); i++) {
    EXPECT_EQ(snapshot.tag_uid.bytes[i], kTestUid[i]);
  }
  EXPECT_TRUE(snapshot.ntag_uid.empty());
}

TEST(AppStateTest, OnVerifyingTransitionsToVerifying) {
  AppState state;
  AppStateSnapshot snapshot;

  constexpr auto kTestUid = pw::bytes::Array<0x04, 0x11, 0x22>();
  state.OnTagDetected(kTestUid);
  state.OnVerifying();
  state.GetSnapshot(snapshot);

  EXPECT_EQ(snapshot.state, AppStateId::kVerifying);
  // tag_uid preserved during verification
  EXPECT_EQ(snapshot.tag_uid.size, kTestUid.size());
}

TEST(AppStateTest, OnTagVerifiedTransitionsToGenuine) {
  AppState state;
  AppStateSnapshot snapshot;

  constexpr auto kRfUid = pw::bytes::Array<0x04, 0x11, 0x22>();
  constexpr auto kNtagUid =
      pw::bytes::Array<0x04, 0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF>();

  state.OnTagDetected(kRfUid);
  state.OnVerifying();
  state.OnTagVerified(kNtagUid);
  state.GetSnapshot(snapshot);

  EXPECT_EQ(snapshot.state, AppStateId::kGenuine);
  // RF-layer UID still set
  EXPECT_EQ(snapshot.tag_uid.size, kRfUid.size());
  // Real NTAG UID now available
  EXPECT_EQ(snapshot.ntag_uid.size, kNtagUid.size());
  for (size_t i = 0; i < kNtagUid.size(); i++) {
    EXPECT_EQ(snapshot.ntag_uid.bytes[i], kNtagUid[i]);
  }
}

TEST(AppStateTest, OnUnknownTagTransitionsToUnknownTag) {
  AppState state;
  AppStateSnapshot snapshot;

  constexpr auto kTestUid = pw::bytes::Array<0x04, 0x11, 0x22>();
  state.OnTagDetected(kTestUid);
  state.OnUnknownTag();
  state.GetSnapshot(snapshot);

  EXPECT_EQ(snapshot.state, AppStateId::kUnknownTag);
}

TEST(AppStateTest, OnTagRemovedTransitionsToIdle) {
  AppState state;
  AppStateSnapshot snapshot;

  constexpr auto kTestUid = pw::bytes::Array<0x04, 0xAA, 0xBB, 0xCC>();
  state.OnTagDetected(kTestUid);
  state.OnTagRemoved();
  state.GetSnapshot(snapshot);

  EXPECT_EQ(snapshot.state, AppStateId::kIdle);
  EXPECT_TRUE(snapshot.tag_uid.empty());
  EXPECT_TRUE(snapshot.ntag_uid.empty());
}

TEST(AppStateTest, OnTagRemovedClearsNtagUid) {
  AppState state;
  AppStateSnapshot snapshot;

  constexpr auto kRfUid = pw::bytes::Array<0x04, 0x11, 0x22>();
  constexpr auto kNtagUid =
      pw::bytes::Array<0x04, 0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF>();

  state.OnTagDetected(kRfUid);
  state.OnVerifying();
  state.OnTagVerified(kNtagUid);
  state.OnTagRemoved();
  state.GetSnapshot(snapshot);

  EXPECT_EQ(snapshot.state, AppStateId::kIdle);
  EXPECT_TRUE(snapshot.tag_uid.empty());
  EXPECT_TRUE(snapshot.ntag_uid.empty());
}

TEST(AppStateTest, TagUidPreservedAcrossDetections) {
  AppState state;
  AppStateSnapshot snapshot;

  constexpr auto kUid1 = pw::bytes::Array<0x01, 0x02, 0x03, 0x04>();
  constexpr auto kUid2 = pw::bytes::Array<0xAA, 0xBB, 0xCC, 0xDD, 0xEE>();

  state.OnTagDetected(kUid1);
  state.GetSnapshot(snapshot);
  EXPECT_EQ(snapshot.tag_uid.size, 4u);

  state.OnTagDetected(kUid2);
  state.GetSnapshot(snapshot);
  EXPECT_EQ(snapshot.tag_uid.size, 5u);
  EXPECT_EQ(snapshot.tag_uid.bytes[0], std::byte{0xAA});
}

TEST(AppStateTest, SnapshotIsCopy) {
  AppState state;
  AppStateSnapshot snapshot;

  constexpr auto kTestUid = pw::bytes::Array<0x04, 0x11, 0x22>();
  state.OnTagDetected(kTestUid);
  state.GetSnapshot(snapshot);

  // Modify state after snapshot
  state.OnTagRemoved();

  // Snapshot should still have old values
  EXPECT_EQ(snapshot.state, AppStateId::kTagDetected);
  EXPECT_EQ(snapshot.tag_uid.size, 3u);
}

TEST(AppStateTest, OnTagDetectedClearsStaleNtagUid) {
  AppState state;
  AppStateSnapshot snapshot;

  constexpr auto kRfUid = pw::bytes::Array<0x04, 0x11, 0x22>();
  constexpr auto kNtagUid =
      pw::bytes::Array<0x04, 0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF>();

  // First tag verified
  state.OnTagDetected(kRfUid);
  state.OnVerifying();
  state.OnTagVerified(kNtagUid);

  // New tag detected (without going through kIdle if reader re-reports)
  constexpr auto kNewRfUid = pw::bytes::Array<0x04, 0x99, 0x88>();
  state.OnTagDetected(kNewRfUid);
  state.GetSnapshot(snapshot);

  EXPECT_EQ(snapshot.state, AppStateId::kTagDetected);
  // ntag_uid cleared for the new tag
  EXPECT_TRUE(snapshot.ntag_uid.empty());
}

}  // namespace
}  // namespace maco::app_state
