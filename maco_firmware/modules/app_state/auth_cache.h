// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <array>
#include <optional>

#include "maco_firmware/types.h"
#include "pw_chrono/system_clock.h"
#include "pw_string/string.h"

namespace maco::app_state {

/// Cached authorization result for a tag.
struct CachedAuth {
  maco::FirebaseId auth_id;
  pw::InlineString<64> user_label;
};

/// Fixed-size cache mapping TagUid → authorization result with expiry.
///
/// Avoids repeated cloud calls for recently-authorized tags.
/// Uses oldest-entry eviction when full.
class AuthCache {
 public:
  static constexpr size_t kCapacity = 8;
  static constexpr auto kDefaultTtl = std::chrono::hours(4);

  /// Look up a tag in the cache. Returns nullopt on miss or expiry.
  std::optional<CachedAuth> Lookup(
      const maco::TagUid& tag_uid,
      pw::chrono::SystemClock::time_point now) {
    for (auto& entry : entries_) {
      if (!entry.valid) continue;
      if (entry.tag_uid == tag_uid) {
        if (now >= entry.expiry) {
          entry.valid = false;
          return std::nullopt;
        }
        return CachedAuth{entry.auth_id, entry.user_label};
      }
    }
    return std::nullopt;
  }

  /// Insert or update an entry. Evicts oldest entry when full.
  void Insert(const maco::TagUid& tag_uid,
              const maco::FirebaseId& auth_id,
              std::string_view user_label,
              pw::chrono::SystemClock::time_point now,
              pw::chrono::SystemClock::duration ttl = kDefaultTtl) {
    // Update existing entry if present
    for (auto& entry : entries_) {
      if (entry.valid && entry.tag_uid == tag_uid) {
        entry.auth_id = auth_id;
        entry.user_label = pw::InlineString<64>(user_label);
        entry.inserted_at = now;
        entry.expiry = now + ttl;
        return;
      }
    }

    // Find an empty slot
    for (auto& entry : entries_) {
      if (!entry.valid) {
        entry = Entry{
            .tag_uid = tag_uid,
            .auth_id = auth_id,
            .user_label = pw::InlineString<64>(user_label),
            .inserted_at = now,
            .expiry = now + ttl,
            .valid = true,
        };
        return;
      }
    }

    // Evict oldest entry
    Entry* oldest = &entries_[0];
    for (auto& entry : entries_) {
      if (entry.inserted_at < oldest->inserted_at) {
        oldest = &entry;
      }
    }
    *oldest = Entry{
        .tag_uid = tag_uid,
        .auth_id = auth_id,
        .user_label = pw::InlineString<64>(user_label),
        .inserted_at = now,
        .expiry = now + ttl,
        .valid = true,
    };
  }

  /// Clear all entries.
  void Clear() {
    for (auto& entry : entries_) {
      entry.valid = false;
    }
  }

 private:
  struct Entry {
    maco::TagUid tag_uid = maco::TagUid::FromArray({});
    maco::FirebaseId auth_id = maco::FirebaseId::Empty();
    pw::InlineString<64> user_label;
    pw::chrono::SystemClock::time_point inserted_at{};
    pw::chrono::SystemClock::time_point expiry{};
    bool valid = false;
  };

  std::array<Entry, kCapacity> entries_{};
};

}  // namespace maco::app_state
