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

/// Tag/user was rejected.
struct CheckinRejected {
  /// User-readable rejection message
  pw::InlineString<128> message;
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

// =============================================================================
// Domain types for KeyDiversification response
// =============================================================================

/// Diversified keys for tag personalization.
struct KeyDiversificationResult {
  std::array<std::byte, 16> application_key;
  std::array<std::byte, 16> authorization_key;
  std::array<std::byte, 16> sdm_mac_key;
  std::array<std::byte, 16> reserved2_key;
};

}  // namespace maco::firebase
