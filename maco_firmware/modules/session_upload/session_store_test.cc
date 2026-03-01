// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "session_upload/session_store.h"

#include "pw_kvs/crc16_checksum.h"
#include "pw_kvs/fake_flash_memory.h"
#include "pw_kvs/key_value_store.h"
#include "pw_unit_test/framework.h"

namespace maco::session_upload {
namespace {

// Small flash for tests: 4 sectors of 512 bytes each (2KB total)
constexpr size_t kSectorCount = 4;
constexpr size_t kSectorSize = 512;

pw::kvs::ChecksumCrc16 kvs_checksum;
constexpr pw::kvs::EntryFormat kvs_format = {.magic = 0xba5e0001,
                                              .checksum = &kvs_checksum};

class SessionStoreTest : public ::testing::Test {
 protected:
  void SetUp() override {
    ASSERT_EQ(partition_.Erase(), pw::OkStatus());
    ASSERT_EQ(kvs_.Init(), pw::OkStatus());
  }

  pw::kvs::FakeFlashMemoryBuffer<kSectorSize, kSectorCount> flash_;
  pw::kvs::FlashPartition partition_{&flash_};
  pw::kvs::KeyValueStoreBuffer<16, kSectorCount> kvs_{&partition_, kvs_format};
  SessionStore store_{kvs_};
};

TEST_F(SessionStoreTest, NoOrphanedSessionInitially) {
  EXPECT_FALSE(store_.HasOrphanedSession());
}

TEST_F(SessionStoreTest, SaveAndLoadOrphanedSession) {
  app_state::SessionInfo session;
  session.tag_uid =
      TagUid::FromArray({std::byte{0x04}, std::byte{0x01}, std::byte{0x02},
                         std::byte{0x03}, std::byte{0x04}, std::byte{0x05},
                         std::byte{0x06}});
  auto user_id = FirebaseId::FromString("user123");
  ASSERT_TRUE(user_id.ok());
  session.user_id = *user_id;
  session.user_label = pw::InlineString<64>("Test User");
  auto auth_id = FirebaseId::FromString("auth456");
  ASSERT_TRUE(auth_id.ok());
  session.auth_id = *auth_id;
  session.started_at = pw::chrono::SystemClock::time_point(
      std::chrono::seconds(100));

  // Save with a known UTC offset
  ASSERT_EQ(store_.SaveActiveSession(session, /*utc_offset=*/1000),
            pw::OkStatus());
  EXPECT_TRUE(store_.HasOrphanedSession());

  // Load and verify
  auto loaded = store_.LoadOrphanedSession();
  ASSERT_TRUE(loaded.ok());
  EXPECT_EQ(loaded->tag_uid, session.tag_uid);
  EXPECT_EQ(loaded->user_id, session.user_id);
  EXPECT_EQ(loaded->auth_id, session.auth_id);

  // started_at is stored as unix seconds (100 + 1000 = 1100)
  auto expected_started = pw::chrono::SystemClock::time_point(
      std::chrono::seconds(1100));
  EXPECT_EQ(loaded->started_at, expected_started);
}

TEST_F(SessionStoreTest, ClearActiveSession) {
  app_state::SessionInfo session;
  session.user_label = pw::InlineString<64>("Test");
  ASSERT_EQ(store_.SaveActiveSession(session, 0), pw::OkStatus());
  EXPECT_TRUE(store_.HasOrphanedSession());

  ASSERT_EQ(store_.ClearActiveSession(), pw::OkStatus());
  EXPECT_FALSE(store_.HasOrphanedSession());
}

TEST_F(SessionStoreTest, ClearAlreadyClearedIsOk) {
  EXPECT_EQ(store_.ClearActiveSession(), pw::OkStatus());
}

TEST_F(SessionStoreTest, NoPendingUsageInitially) {
  EXPECT_EQ(store_.PendingUsageCount(), 0u);
}

TEST_F(SessionStoreTest, StoreAndLoadPendingUsage) {
  app_state::MachineUsage usage;
  auto user_id = FirebaseId::FromString("user1");
  ASSERT_TRUE(user_id.ok());
  usage.user_id = *user_id;
  auto auth_id = FirebaseId::FromString("auth1");
  ASSERT_TRUE(auth_id.ok());
  usage.auth_id = *auth_id;
  usage.check_in =
      pw::chrono::SystemClock::time_point(std::chrono::seconds(100));
  usage.check_out =
      pw::chrono::SystemClock::time_point(std::chrono::seconds(200));
  usage.reason = app_state::CheckoutReason::kUiCheckout;

  // Store with utc_offset=1000
  ASSERT_EQ(store_.StoreCompletedUsage(usage, 1000), pw::OkStatus());
  EXPECT_EQ(store_.PendingUsageCount(), 1u);

  // Load and verify
  auto loaded = store_.LoadPendingUsage();
  ASSERT_TRUE(loaded.ok());
  ASSERT_EQ(loaded->records_count, 1u);
  EXPECT_EQ(loaded->records[0].check_in, 1100);   // 100 + 1000
  EXPECT_EQ(loaded->records[0].check_out, 1200);   // 200 + 1000
  EXPECT_EQ(loaded->records[0].reason,
            static_cast<int32_t>(app_state::CheckoutReason::kUiCheckout));
}

TEST_F(SessionStoreTest, ClearPendingUsage) {
  app_state::MachineUsage usage;
  ASSERT_EQ(store_.StoreCompletedUsage(usage, 0), pw::OkStatus());
  EXPECT_EQ(store_.PendingUsageCount(), 1u);

  ASSERT_EQ(store_.ClearPendingUsage(), pw::OkStatus());
  EXPECT_EQ(store_.PendingUsageCount(), 0u);
}

}  // namespace
}  // namespace maco::session_upload
