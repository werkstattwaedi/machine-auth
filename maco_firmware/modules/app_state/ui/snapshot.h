// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <array>
#include <cstddef>
#include <optional>

#include "maco_firmware/modules/app_state/tag_verification_state.h"
#include "maco_firmware/modules/time/local_time.h"
#include "maco_firmware/types.h"
#include "pw_chrono/system_clock.h"
#include "pw_string/string.h"

namespace maco::app_state {

// Maximum tag UID size (NTAG424 uses 7 bytes, but allow for other tags)
inline constexpr size_t kMaxTagUidSize = 10;

// Tag UID with size (value type, safe to copy)
struct TagUid {
  std::array<std::byte, kMaxTagUidSize> bytes{};
  size_t size = 0;

  bool empty() const { return size == 0; }
};

// Session state for UI display
enum class SessionStateUi : uint8_t {
  kNoSession = 0,
  kRunning = 1,
  kCheckoutPending = 2,
  kTakeoverPending = 3,
};

// Session snapshot for UI - confirmation progress and user labels
struct SessionSnapshotUi {
  SessionStateUi state = SessionStateUi::kNoSession;
  pw::InlineString<64> session_user_label;
  pw::InlineString<64> pending_user_label;  // For takeover display
  pw::chrono::SystemClock::time_point pending_since;
  pw::chrono::SystemClock::time_point pending_deadline;
  pw::chrono::SystemClock::time_point tag_present_since;
  bool tag_present = false;
};

// Tag verification snapshot - the portion owned by TagVerifier.
struct TagVerificationSnapshot {
  TagVerificationState state = TagVerificationState::kIdle;
  TagUid tag_uid;   // RF-layer UID (kTagDetected onward)
  TagUid ntag_uid;  // Real 7-byte NTAG424 UID from GetCardUid (kGenuine only)

  // Authorization fields (kAuthorized only)
  pw::InlineString<64> user_label;
  maco::FirebaseId auth_id = maco::FirebaseId::Empty();
};

// System-level connectivity and boot state for UI display
enum class BootState : uint8_t { kBooting = 0, kReady = 1 };
enum class WifiState : uint8_t {
  kDisconnected = 0,
  kConnecting = 1,
  kConnected = 2,
};
enum class CloudState : uint8_t {
  kDisconnected = 0,
  kConnecting = 1,
  kConnected = 2,
};

struct SystemStateSnapshot {
  BootState boot_state = BootState::kBooting;
  WifiState wifi_state = WifiState::kDisconnected;
  CloudState cloud_state = CloudState::kDisconnected;
  bool gateway_connected = false;

  // Zurich local time, already converted from UTC. nullopt if time not synced.
  std::optional<time::LocalTime> local_time;
};

// Combined snapshot for the dev app UI thread.
// Composed from tag verification + session + system state.
struct AppStateSnapshot {
  TagVerificationSnapshot verification;
  SessionSnapshotUi session;
  SystemStateSnapshot system;
};

}  // namespace maco::app_state
