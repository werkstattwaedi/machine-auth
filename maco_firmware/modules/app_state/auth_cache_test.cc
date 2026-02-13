// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/modules/app_state/auth_cache.h"

#include "pw_chrono/system_clock.h"
#include "pw_unit_test/framework.h"

namespace maco::app_state {
namespace {

using Clock = pw::chrono::SystemClock;

maco::TagUid MakeTagUid(uint8_t last_byte) {
  return maco::TagUid::FromArray(
      {std::byte{0x04}, std::byte{0x11}, std::byte{0x22}, std::byte{0x33},
       std::byte{0x44}, std::byte{0x55}, std::byte{last_byte}});
}

maco::FirebaseId MakeAuthId(const char* str) {
  return *maco::FirebaseId::FromString(str);
}

TEST(AuthCacheTest, LookupMiss) {
  AuthCache cache;
  auto now = Clock::now();
  auto result = cache.Lookup(MakeTagUid(0x01), now);
  EXPECT_FALSE(result.has_value());
}

TEST(AuthCacheTest, InsertAndLookup) {
  AuthCache cache;
  auto now = Clock::now();
  auto uid = MakeTagUid(0x01);

  cache.Insert(uid, MakeAuthId("auth123"), "Test User", now);

  auto result = cache.Lookup(uid, now);
  ASSERT_TRUE(result.has_value());
  EXPECT_EQ(result->auth_id.value(), "auth123");
  EXPECT_EQ(std::string_view(result->user_label), "Test User");
}

TEST(AuthCacheTest, Expiry) {
  AuthCache cache;
  auto now = Clock::now();
  auto uid = MakeTagUid(0x01);
  auto ttl = std::chrono::hours(1);

  cache.Insert(uid, MakeAuthId("auth123"), "User", now, ttl);

  // Before expiry
  auto result = cache.Lookup(uid, now + std::chrono::minutes(59));
  ASSERT_TRUE(result.has_value());

  // At expiry
  result = cache.Lookup(uid, now + ttl);
  EXPECT_FALSE(result.has_value());

  // After expiry
  result = cache.Lookup(uid, now + ttl + std::chrono::seconds(1));
  EXPECT_FALSE(result.has_value());
}

TEST(AuthCacheTest, UpdateExisting) {
  AuthCache cache;
  auto now = Clock::now();
  auto uid = MakeTagUid(0x01);

  cache.Insert(uid, MakeAuthId("old_auth"), "Old Name", now);
  cache.Insert(uid, MakeAuthId("new_auth"), "New Name", now);

  auto result = cache.Lookup(uid, now);
  ASSERT_TRUE(result.has_value());
  EXPECT_EQ(result->auth_id.value(), "new_auth");
  EXPECT_EQ(std::string_view(result->user_label), "New Name");
}

TEST(AuthCacheTest, EvictionWhenFull) {
  AuthCache cache;
  auto now = Clock::now();

  // Fill all 8 slots
  for (uint8_t i = 0; i < AuthCache::kCapacity; i++) {
    cache.Insert(MakeTagUid(i), MakeAuthId("auth"), "User",
                 now + std::chrono::seconds(i));
  }

  // Insert one more - should evict the oldest (tag 0x00)
  cache.Insert(MakeTagUid(0xFF), MakeAuthId("new"), "New User",
               now + std::chrono::seconds(AuthCache::kCapacity));

  // Oldest entry should be gone
  auto result = cache.Lookup(
      MakeTagUid(0x00), now + std::chrono::seconds(AuthCache::kCapacity));
  EXPECT_FALSE(result.has_value());

  // New entry should be present
  result = cache.Lookup(
      MakeTagUid(0xFF), now + std::chrono::seconds(AuthCache::kCapacity));
  ASSERT_TRUE(result.has_value());
  EXPECT_EQ(result->auth_id.value(), "new");
}

TEST(AuthCacheTest, Clear) {
  AuthCache cache;
  auto now = Clock::now();
  auto uid = MakeTagUid(0x01);

  cache.Insert(uid, MakeAuthId("auth123"), "User", now);
  cache.Clear();

  auto result = cache.Lookup(uid, now);
  EXPECT_FALSE(result.has_value());
}

TEST(AuthCacheTest, DifferentTagsDontInterfere) {
  AuthCache cache;
  auto now = Clock::now();
  auto uid1 = MakeTagUid(0x01);
  auto uid2 = MakeTagUid(0x02);

  cache.Insert(uid1, MakeAuthId("auth1"), "User 1", now);
  cache.Insert(uid2, MakeAuthId("auth2"), "User 2", now);

  auto r1 = cache.Lookup(uid1, now);
  auto r2 = cache.Lookup(uid2, now);
  ASSERT_TRUE(r1.has_value());
  ASSERT_TRUE(r2.has_value());
  EXPECT_EQ(r1->auth_id.value(), "auth1");
  EXPECT_EQ(r2->auth_id.value(), "auth2");
}

}  // namespace
}  // namespace maco::app_state
