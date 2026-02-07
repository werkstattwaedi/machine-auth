// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/modules/nfc_tag/ntag424/cloud_key_provider.h"

#include <variant>

#include "pw_assert/check.h"
#include "pw_log/log.h"

namespace maco::nfc {

namespace {
constexpr size_t kEncryptedRndBSize = 16;
constexpr size_t kEncryptedPart3Size = 32;
constexpr size_t kCloudChallengeSize = 32;
}  // namespace

CloudKeyProvider::CloudKeyProvider(firebase::FirebaseClient& firebase_client,
                                   const TagUid& tag_uid,
                                   uint8_t key_number)
    : firebase_client_(firebase_client),
      tag_uid_(tag_uid),
      key_number_(key_number) {
  PW_CHECK_UINT_LE(key_number, 4, "Key number must be 0-4");
}

firebase::Key CloudKeyProvider::KeyNumberToEnum(uint8_t key_number) {
  // Key 0 = APPLICATION (1), Key 1 = TERMINAL (2), etc.
  return static_cast<firebase::Key>(key_number + 1);
}

pw::async2::Coro<pw::Result<std::array<std::byte, 32>>>
CloudKeyProvider::CreateNtagChallenge(pw::async2::CoroContext& cx,
                                      pw::ConstByteSpan encrypted_rnd_b) {
  // Validate input size
  if (encrypted_rnd_b.size() != kEncryptedRndBSize) {
    PW_LOG_ERROR("CreateNtagChallenge: invalid input size %zu, expected %zu",
                 encrypted_rnd_b.size(),
                 kEncryptedRndBSize);
    co_return pw::Status::InvalidArgument();
  }

  // Clear any previous authentication state
  CancelAuthentication();

  // Forward to cloud
  auto result = co_await firebase_client_.AuthenticateTag(
      cx, tag_uid_, KeyNumberToEnum(key_number_), encrypted_rnd_b);

  if (!result.ok()) {
    PW_LOG_ERROR("AuthenticateTag RPC failed: %d",
                 static_cast<int>(result.status().code()));
    co_return result.status();
  }

  // Store auth_id for CompleteTagAuth
  stored_auth_id_ = result->auth_id;

  // Extract cloud_challenge and validate size
  const auto& challenge = result->cloud_challenge;
  if (challenge.size() != kCloudChallengeSize) {
    PW_LOG_ERROR("Invalid cloud_challenge size %zu, expected %zu",
                 challenge.size(),
                 kCloudChallengeSize);
    CancelAuthentication();
    co_return pw::Status::Internal();
  }

  // Copy to fixed-size array
  std::array<std::byte, 32> part2_response;
  std::copy(challenge.begin(), challenge.end(), part2_response.begin());

  co_return part2_response;
}

pw::async2::Coro<pw::Result<SessionKeys>>
CloudKeyProvider::VerifyAndComputeSessionKeys(
    pw::async2::CoroContext& cx,
    pw::ConstByteSpan encrypted_part3) {
  // Validate input size
  if (encrypted_part3.size() != kEncryptedPart3Size) {
    PW_LOG_ERROR(
        "VerifyAndComputeSessionKeys: invalid input size %zu, expected %zu",
        encrypted_part3.size(),
        kEncryptedPart3Size);
    co_return pw::Status::InvalidArgument();
  }

  // Check we have auth_id from CreateNtagChallenge
  if (!stored_auth_id_) {
    PW_LOG_ERROR(
        "VerifyAndComputeSessionKeys: no auth_id - must call "
        "CreateNtagChallenge first");
    co_return pw::Status::FailedPrecondition();
  }

  // Forward to cloud
  auto result = co_await firebase_client_.CompleteTagAuth(
      cx, *stored_auth_id_, encrypted_part3);

  if (!result.ok()) {
    PW_LOG_ERROR("CompleteTagAuth RPC failed: %d",
                 static_cast<int>(result.status().code()));
    CancelAuthentication();
    co_return result.status();
  }

  // Check for rejection
  if (std::holds_alternative<firebase::CompleteAuthRejected>(*result)) {
    const auto& rejected = std::get<firebase::CompleteAuthRejected>(*result);
    PW_LOG_WARN("CompleteTagAuth rejected: %s", rejected.message.c_str());
    CancelAuthentication();
    co_return pw::Status::Unauthenticated();
  }

  // Extract session keys from success variant
  const auto& keys = std::get<firebase::CompleteAuthSuccess>(*result);

  // Copy to SessionKeys structure (arrays are already fixed-size)
  SessionKeys session_keys;
  session_keys.ses_auth_enc_key = keys.ses_auth_enc_key;
  session_keys.ses_auth_mac_key = keys.ses_auth_mac_key;
  session_keys.transaction_identifier = keys.transaction_identifier;
  session_keys.picc_capabilities = keys.picc_capabilities;

  // Keep stored_auth_id_ for caller to retrieve via auth_id()
  // (Don't clear it on success - that's the whole point!)

  co_return session_keys;
}

void CloudKeyProvider::CancelAuthentication() { stored_auth_id_.reset(); }

}  // namespace maco::nfc
