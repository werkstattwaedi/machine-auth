// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

/// @file firebase/types.h
/// @brief Domain types for Firebase RPC responses.
///
/// These types represent the domain-specific result types from Firebase
/// Cloud Function calls. They decouple the API from protobuf format.

#include <array>
#include <cstddef>
#include <cstdint>
#include <variant>

#include "maco_firmware/types.h"
#include "pw_string/string.h"

namespace maco::firebase {

// =============================================================================
// Domain types for TerminalCheckin response (has oneof)
// =============================================================================

/// User is authorized to use the machine.
struct CheckinAuthorized {
  /// Firebase user ID
  FirebaseId user_id;
  /// Display name for the user
  pw::InlineString<64> user_label;
  /// If non-empty, authentication is already complete and can be reused.
  /// If empty, client must do auth flow before activating machine.
  FirebaseId authentication_id;

  /// Returns true if authentication is already complete (can skip auth flow).
  bool has_existing_auth() const { return !authentication_id.empty(); }
};

/// Machine-readable cause of a rejection. Lets the UI branch on layout (e.g.
/// the stale-checkout screen with its QR) without parsing German prose.
///
/// IMPORTANT: the integer values MUST stay aligned with the `RejectionReason`
/// proto enum in `proto/firebase_rpc/auth.proto` and the TypeScript
/// `RejectionReason` enum in `shared/src/rejection.ts` (@oww/shared). Adding a
/// value means adding it in all three places with the same number.
enum class RejectionReason : uint8_t {
  kUnspecified = 0,  // generic — render the default denied screen
  kMissingPermission = 1,
  kStaleCheckout = 2,
  kTokenUnknown = 3,
  kTokenDeactivated = 4,
};

/// Tag/user was rejected.
struct CheckinRejected {
  /// User-readable rejection message (rendered verbatim by the UI).
  pw::InlineString<128> message;
  /// Machine-readable cause the UI branches on.
  RejectionReason reason = RejectionReason::kUnspecified;
  /// Deep link to the /denied landing page, rendered as a QR code. Empty when
  /// there is nothing actionable. Sized to match the nanopb action_url buffer
  /// (auth.options max_size:256): the /denied URL with cause+uid+checkout+since
  /// query params runs ~140-170 chars, past the old 128.
  pw::InlineString<256> action_url;
};

/// Result of TerminalCheckin - either authorized or rejected.
using CheckinResult = std::variant<CheckinAuthorized, CheckinRejected>;

// =============================================================================
// Domain types for AuthenticateTag response
// =============================================================================

/// Response from AuthenticateTag - ephemeral auth ID and cloud challenge.
struct AuthenticateTagResponse {
  /// Ephemeral authentication ID (~1 min validity for crypto completion)
  FirebaseId auth_id;
  /// Combined challenge response to send to tag (Part 2), max 32 bytes
  std::array<std::byte, 32> cloud_challenge;
  /// Actual size of cloud_challenge data
  size_t cloud_challenge_size;
};

// =============================================================================
// Domain types for CompleteTagAuth response (has oneof)
// =============================================================================

/// Authentication completed successfully with session keys.
struct CompleteAuthSuccess {
  /// Derived session encryption key (AES-128)
  std::array<std::byte, 16> ses_auth_enc_key;
  /// Derived session MAC key (AES-128)
  std::array<std::byte, 16> ses_auth_mac_key;
  /// Transaction identifier from Part 3 response
  std::array<std::byte, 4> transaction_identifier;
  /// PICC capabilities (PDcap2) from Part 3 response
  std::array<std::byte, 6> picc_capabilities;
};

/// Authentication was rejected.
struct CompleteAuthRejected {
  /// User-readable rejection message
  pw::InlineString<128> message;
};

/// Result of CompleteTagAuth - either success with keys or rejected.
using CompleteAuthResult =
    std::variant<CompleteAuthSuccess, CompleteAuthRejected>;

}  // namespace maco::firebase
