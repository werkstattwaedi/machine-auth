// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <optional>

#include "firebase/firebase_client.h"
#include "maco_firmware/modules/nfc_tag/ntag424/ntag424_key_provider.h"
#include "pw_async2/coro.h"
#include "pw_bytes/span.h"
#include "pw_result/result.h"

namespace maco::nfc {

/// Key provider that delegates NTAG424 authentication to Firebase cloud.
///
/// The cloud handles all cryptography (key diversification, RndA generation,
/// session key derivation) - firmware only forwards encrypted data between
/// tag and cloud.
///
/// After successful authentication, the auth_id() getter returns the Firebase
/// authentication record ID, which can be used for session tracking.
///
/// Usage:
/// @code
///   CloudKeyProvider key_provider(firebase_client, tag_uid, /*key_number=*/0);
///
///   auto session_result = co_await tag.Authenticate(cx, key_provider);
///   if (!session_result.ok()) {
///     co_return session_result.status();
///   }
///
///   // Get auth_id for session tracking
///   if (key_provider.auth_id()) {
///     auto& auth_id = key_provider.auth_id()->value;
///     // Use auth_id to track session in Firebase...
///   }
/// @endcode
class CloudKeyProvider : public Ntag424KeyProvider {
 public:
  /// Construct a cloud key provider.
  /// @param firebase_client Firebase client for RPC calls
  /// @param tag_uid 7-byte NTAG UID
  /// @param key_number Key slot (0-4) to authenticate with
  CloudKeyProvider(firebase::FirebaseClient& firebase_client,
                   const firebase::TagUid& tag_uid,
                   uint8_t key_number);

  /// Get the key slot number this provider authenticates.
  uint8_t key_number() const override { return key_number_; }

  /// Create Part 2 response by forwarding to cloud.
  ///
  /// Forwards encrypted_rnd_b to cloud via AuthenticateTag().
  /// Cloud decrypts, generates RndA, encrypts Part 2 response.
  /// Stores returned auth_id for CompleteTagAuth.
  ///
  /// @param cx Coroutine context for suspension
  /// @param encrypted_rnd_b Tag's encrypted challenge from Part 1 (16 bytes)
  /// @return 32-byte Part 2 response, or error
  pw::async2::Coro<pw::Result<std::array<std::byte, 32>>> CreateNtagChallenge(
      pw::async2::CoroContext& cx,
      pw::ConstByteSpan encrypted_rnd_b) override;

  /// Verify Part 3 and get session keys from cloud.
  ///
  /// Forwards encrypted_part3 to cloud via CompleteTagAuth().
  /// Cloud verifies RndA' and derives session keys.
  /// On success, keeps stored_auth_id_ for caller to retrieve via auth_id().
  /// On failure, clears stored_auth_id_.
  ///
  /// @param cx Coroutine context for suspension
  /// @param encrypted_part3 Tag's encrypted Part 3 response (32 bytes)
  /// @return SessionKeys on success, or error
  pw::async2::Coro<pw::Result<SessionKeys>> VerifyAndComputeSessionKeys(
      pw::async2::CoroContext& cx,
      pw::ConstByteSpan encrypted_part3) override;

  /// Clear stored auth_id (cloud handles its own timeout).
  void CancelAuthentication() override;

  /// Get the authentication ID after successful authentication.
  ///
  /// Returns the Firebase auth record ID, used for session tracking.
  /// Only valid after VerifyAndComputeSessionKeys succeeds.
  const std::optional<firebase::FirebaseId>& auth_id() const {
    return stored_auth_id_;
  }

 private:
  /// Convert key_number (0-4) to Key enum (APPLICATION=1, TERMINAL=2, ...).
  static firebase::Key KeyNumberToEnum(uint8_t key_number);

  firebase::FirebaseClient& firebase_client_;
  firebase::TagUid tag_uid_;
  uint8_t key_number_;
  std::optional<firebase::FirebaseId> stored_auth_id_;
};

}  // namespace maco::nfc
