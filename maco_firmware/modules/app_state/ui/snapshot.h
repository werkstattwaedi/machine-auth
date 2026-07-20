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
  kStopPending = 4,
  kEndingSoon = 5,  // Idle auto-end warning countdown
};

// Session snapshot for UI - confirmation progress and user labels
struct SessionSnapshotUi {
  SessionStateUi state = SessionStateUi::kNoSession;
  pw::InlineString<64> session_user_label;
  pw::InlineString<64> pending_user_label;  // For takeover display
  pw::chrono::SystemClock::time_point pending_since;
  pw::chrono::SystemClock::time_point pending_deadline;
  pw::chrono::SystemClock::time_point tag_present_since;
  pw::chrono::SystemClock::time_point session_started_at;
  bool tag_present = false;
};

// Machine-readable cause of a cloud rejection (kUnauthorized only). Lets the
// screen branch on layout — e.g. the stale-checkout screen with its QR —
// without parsing the German message.
//
// Mirrors maco::firebase::RejectionReason (firebase/types.h), the proto
// RejectionReason (proto/firebase_rpc/auth.proto) and the TypeScript enum
// (shared/src/rejection.ts). Values MUST stay aligned across all four.
enum class RejectionReason : uint8_t {
  kUnspecified = 0,
  kMissingPermission = 1,
  kStaleCheckout = 2,
  kTokenUnknown = 3,
  kTokenDeactivated = 4,
};

// Tag verification snapshot - the portion owned by TagVerifier.
struct TagVerificationSnapshot {
  TagVerificationState state = TagVerificationState::kIdle;
  TagUid tag_uid;   // RF-layer UID (kTagDetected onward)
  TagUid ntag_uid;  // Real 7-byte NTAG424 UID from GetCardUid (kGenuine only)

  // Authorization fields (kAuthorized only)
  pw::InlineString<64> user_label;
  maco::FirebaseId auth_id = maco::FirebaseId::Empty();

  // Rejection fields (kUnauthorized only). The server is the source of truth
  // for the message + cause; the screen renders the message verbatim and shows
  // a QR of the action URL for the stale-checkout case (issue #535).
  RejectionReason rejection_reason = RejectionReason::kUnspecified;
  pw::InlineString<128> rejection_message;
  // 256 to match firebase::CheckinRejected::action_url / the nanopb buffer.
  pw::InlineString<256> rejection_action_url;
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

  // Machine label from device config (e.g. "Fräse").
  pw::InlineString<64> machine_label;
};

// Machine control state for UI display
struct MachineControlSnapshot {
  bool toggle_enabled = false;
  bool machine_running = false;
  // Accumulated in-use (e.g. laser cutting) time this session, in seconds.
  // This is what gets billed and what the on-screen timer shows.
  uint32_t in_use_seconds = 0;
};

// Combined snapshot for the dev app UI thread.
// Composed from tag verification + session + system + machine control state.
struct AppStateSnapshot {
  TagVerificationSnapshot verification;
  SessionSnapshotUi session;
  SystemStateSnapshot system;
  MachineControlSnapshot machine;
};

}  // namespace maco::app_state
