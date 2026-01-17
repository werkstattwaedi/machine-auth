// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/modules/app_state/app_state.h"

#include "pw_bytes/array.h"
#include "pw_unit_test/framework.h"

namespace maco::app_state {
namespace {

TEST(AppStateTest, InitialStateIsNoTag) {
  AppState state;
  AppStateSnapshot snapshot;

  state.GetSnapshot(snapshot);

  EXPECT_EQ(snapshot.state, AppStateId::kNoTag);
  EXPECT_TRUE(snapshot.tag_uid.empty());
}

TEST(AppStateTest, OnTagDetectedTransitionsToHasTag) {
  AppState state;
  AppStateSnapshot snapshot;

  constexpr auto kTestUid = pw::bytes::Array<0x04, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66>();
  state.OnTagDetected(kTestUid);
  state.GetSnapshot(snapshot);

  EXPECT_EQ(snapshot.state, AppStateId::kHasTag);
  EXPECT_EQ(snapshot.tag_uid.size, kTestUid.size());
  for (size_t i = 0; i < kTestUid.size(); i++) {
    EXPECT_EQ(snapshot.tag_uid.bytes[i], kTestUid[i]);
  }
}

TEST(AppStateTest, OnTagRemovedTransitionsToNoTag) {
  AppState state;
  AppStateSnapshot snapshot;

  constexpr auto kTestUid = pw::bytes::Array<0x04, 0xAA, 0xBB, 0xCC>();
  state.OnTagDetected(kTestUid);
  state.OnTagRemoved();
  state.GetSnapshot(snapshot);

  EXPECT_EQ(snapshot.state, AppStateId::kNoTag);
  EXPECT_EQ(snapshot.tag_uid.size, 0u);
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
  EXPECT_EQ(snapshot.state, AppStateId::kHasTag);
  EXPECT_EQ(snapshot.tag_uid.size, 3u);
}

}  // namespace
}  // namespace maco::app_state
