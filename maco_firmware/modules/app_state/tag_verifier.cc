// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#define PW_LOG_MODULE_NAME "VRFY"

#include "maco_firmware/modules/app_state/tag_verifier.h"

#include <variant>

#include "device_secrets/device_secrets.h"
#include "firebase/firebase_client.h"
#include "maco_firmware/devices/pn532/tag_info.h"
#include "maco_firmware/modules/nfc_reader/nfc_event.h"
#include "maco_firmware/modules/nfc_tag/ntag424/cloud_key_provider.h"
#include "maco_firmware/modules/nfc_tag/ntag424/local_key_provider.h"
#include "maco_firmware/modules/nfc_tag/ntag424/ntag424_tag.h"
#include "pw_assert/check.h"
#include "pw_chrono/system_clock.h"
#include "pw_log/log.h"

namespace maco::app_state {

// NTAG424 key slots (slot number = proto enum value - 1)
constexpr uint8_t kTerminalKeyNumber = 1;
constexpr uint8_t kAuthorizationKeyNumber = 2;

TagVerifier::TagVerifier(nfc::NfcReader& reader,
                         secrets::DeviceSecrets& device_secrets,
                         firebase::FirebaseClient& firebase_client,
                         pw::random::RandomGenerator& rng,
                         pw::allocator::Allocator& allocator)
    : reader_(reader),
      device_secrets_(device_secrets),
      firebase_client_(firebase_client),
      rng_(rng),
      coro_cx_(allocator) {}

void TagVerifier::AddObserver(TagVerifierObserver* observer) {
  PW_CHECK_NOTNULL(observer);
  PW_CHECK(observer_count_ < kMaxObservers,
           "Too many tag verifier observers (max %u)",
           static_cast<unsigned>(kMaxObservers));
  observers_[observer_count_++] = observer;
}

void TagVerifier::Start(pw::async2::Dispatcher& dispatcher) {
  auto coro = Run(coro_cx_);
  task_.emplace(std::move(coro), [](pw::Status s) {
    PW_LOG_ERROR("TagVerifier failed: %d", static_cast<int>(s.code()));
  });
  dispatcher.Post(*task_);
}

// --- Notify helpers ---

void TagVerifier::NotifyTagDetected(pw::ConstByteSpan uid) {
  for (size_t i = 0; i < observer_count_; ++i) {
    observers_[i]->OnTagDetected(uid);
  }
}

void TagVerifier::NotifyVerifying() {
  for (size_t i = 0; i < observer_count_; ++i) {
    observers_[i]->OnVerifying();
  }
}

void TagVerifier::NotifyTagVerified(pw::ConstByteSpan ntag_uid) {
  for (size_t i = 0; i < observer_count_; ++i) {
    observers_[i]->OnTagVerified(ntag_uid);
  }
}

void TagVerifier::NotifyUnknownTag() {
  for (size_t i = 0; i < observer_count_; ++i) {
    observers_[i]->OnUnknownTag();
  }
}

void TagVerifier::NotifyAuthorizing() {
  for (size_t i = 0; i < observer_count_; ++i) {
    observers_[i]->OnAuthorizing();
  }
}

void TagVerifier::NotifyAuthorized(const maco::TagUid& tag_uid,
                                   const maco::FirebaseId& user_id,
                                   const pw::InlineString<64>& user_label,
                                   const maco::FirebaseId& auth_id) {
  for (size_t i = 0; i < observer_count_; ++i) {
    observers_[i]->OnAuthorized(tag_uid, user_id, user_label, auth_id);
  }
}

void TagVerifier::NotifyUnauthorized() {
  for (size_t i = 0; i < observer_count_; ++i) {
    observers_[i]->OnUnauthorized();
  }
}

void TagVerifier::NotifyTagRemoved() {
  for (size_t i = 0; i < observer_count_; ++i) {
    observers_[i]->OnTagRemoved();
  }
}

// --- Main loop ---

pw::async2::Coro<pw::Status> TagVerifier::Run(pw::async2::CoroContext& cx) {
  while (true) {
    auto event_future = reader_.SubscribeOnce();
    nfc::NfcEvent event = co_await event_future;

    switch (event.type) {
      case nfc::NfcEventType::kTagArrived: {
        if (!event.tag) {
          PW_LOG_WARN("Tag arrived event with null tag");
          break;
        }
        PW_LOG_INFO("Tag arrived: %u bytes UID",
                    static_cast<unsigned>(event.tag->uid().size()));
        NotifyTagDetected(event.tag->uid());

        auto status = co_await VerifyTag(cx, *event.tag);
        if (!status.ok()) {
          PW_LOG_WARN("Tag verification failed: %d",
                      static_cast<int>(status.code()));
        }
        break;
      }

      case nfc::NfcEventType::kTagDeparted:
        PW_LOG_INFO("Tag departed");
        NotifyTagRemoved();
        break;
    }
  }
  co_return pw::OkStatus();
}

pw::async2::Coro<pw::Status> TagVerifier::VerifyTag(
    pw::async2::CoroContext& cx,
    nfc::NfcTag& tag) {
  // Step 1: Check ISO 14443-4 support
  if (!tag.supports_iso14443_4()) {
    PW_LOG_INFO("Tag does not support ISO 14443-4");
    NotifyUnknownTag();
    co_return pw::OkStatus();
  }

  // Step 2: Reconstruct TagInfo for Ntag424Tag construction
  nfc::TagInfo tag_info{};
  auto uid = tag.uid();
  tag_info.uid_length = uid.size();
  std::copy(uid.begin(), uid.end(), tag_info.uid.begin());
  tag_info.sak = tag.sak();
  tag_info.target_number = tag.target_number();
  tag_info.supports_iso14443_4 = true;

  nfc::Ntag424Tag ntag(reader_, tag_info);

  // Step 3: Select NTAG424 application
  auto select_status = co_await ntag.SelectApplication(cx);
  if (!select_status.ok()) {
    PW_LOG_INFO("SelectApplication failed: %d",
                static_cast<int>(select_status.code()));
    NotifyUnknownTag();
    co_return pw::OkStatus();
  }

  // Step 4: Authenticate with terminal key
  NotifyVerifying();

  auto key_result = device_secrets_.GetNtagTerminalKey();
  if (!key_result.ok()) {
    PW_LOG_ERROR("Terminal key not provisioned");
    NotifyUnknownTag();
    co_return pw::OkStatus();
  }

  nfc::LocalKeyProvider key_provider(
      kTerminalKeyNumber, key_result->bytes(), rng_);

  auto auth_result = co_await ntag.Authenticate(cx, key_provider);
  if (!auth_result.ok()) {
    PW_LOG_INFO("Authentication failed: %d",
                static_cast<int>(auth_result.status().code()));
    NotifyUnknownTag();
    co_return pw::OkStatus();
  }

  // Step 5: Read real card UID
  std::array<std::byte, 7> uid_buffer{};
  auto uid_result = co_await ntag.GetCardUid(
      cx, *auth_result, pw::ByteSpan(uid_buffer));
  if (!uid_result.ok()) {
    PW_LOG_INFO("GetCardUid failed: %d",
                static_cast<int>(uid_result.status().code()));
    NotifyUnknownTag();
    co_return pw::OkStatus();
  }

  pw::ConstByteSpan real_uid(uid_buffer.data(), *uid_result);
  PW_LOG_INFO("Tag verified, real UID: %u bytes",
              static_cast<unsigned>(*uid_result));
  NotifyTagVerified(real_uid);

  // Step 6: Authorize with cloud
  auto tag_uid_result = maco::TagUid::FromBytes(real_uid);
  if (!tag_uid_result.ok()) {
    PW_LOG_ERROR("Invalid UID size for TagUid");
    NotifyUnauthorized();
    co_return pw::OkStatus();
  }

  auto auth_status = co_await AuthorizeTag(cx, ntag, *tag_uid_result);
  if (!auth_status.ok()) {
    PW_LOG_WARN("Authorization failed: %d",
                static_cast<int>(auth_status.code()));
  }

  co_return pw::OkStatus();
}

pw::async2::Coro<pw::Status> TagVerifier::AuthorizeTag(
    pw::async2::CoroContext& cx,
    nfc::Ntag424Tag& ntag,
    const maco::TagUid& tag_uid) {
  // Check cache first
  auto now = pw::chrono::SystemClock::now();
  auto cached = auth_cache_.Lookup(tag_uid, now);
  if (cached) {
    PW_LOG_INFO("Cache hit - skipping cloud authorization");
    NotifyAuthorized(tag_uid, maco::FirebaseId::Empty(),
                     pw::InlineString<64>(cached->user_label),
                     cached->auth_id);
    co_return pw::OkStatus();
  }

  // Cache miss - call cloud
  NotifyAuthorizing();

  auto checkin_result =
      co_await firebase_client_.TerminalCheckin(cx, tag_uid);
  if (!checkin_result.ok()) {
    PW_LOG_ERROR("TerminalCheckin failed: %d",
                 static_cast<int>(checkin_result.status().code()));
    NotifyUnauthorized();
    co_return pw::OkStatus();
  }

  // Check if rejected
  if (std::holds_alternative<firebase::CheckinRejected>(*checkin_result)) {
    const auto& rejected =
        std::get<firebase::CheckinRejected>(*checkin_result);
    PW_LOG_WARN("TerminalCheckin rejected: %s", rejected.message.c_str());
    NotifyUnauthorized();
    co_return pw::OkStatus();
  }

  const auto& authorized =
      std::get<firebase::CheckinAuthorized>(*checkin_result);

  // If checkin returned an existing auth_id, use it directly
  if (authorized.has_existing_auth()) {
    PW_LOG_INFO("Using existing auth from checkin");
    auth_cache_.Insert(tag_uid, authorized.authentication_id,
                       std::string_view(authorized.user_label), now);
    NotifyAuthorized(tag_uid, authorized.user_id,
                     authorized.user_label,
                     authorized.authentication_id);
    co_return pw::OkStatus();
  }

  // No existing auth - do key-2 cloud authentication to get one
  PW_LOG_INFO("No existing auth, performing cloud key auth");

  // Re-select application to reset tag state for new authentication
  auto reselect_status = co_await ntag.SelectApplication(cx);
  if (!reselect_status.ok()) {
    PW_LOG_ERROR("Re-select failed: %d",
                 static_cast<int>(reselect_status.code()));
    NotifyUnauthorized();
    co_return pw::OkStatus();
  }

  nfc::CloudKeyProvider cloud_key_provider(
      firebase_client_, tag_uid, kAuthorizationKeyNumber);

  auto cloud_auth_result = co_await ntag.Authenticate(cx, cloud_key_provider);
  if (!cloud_auth_result.ok()) {
    PW_LOG_WARN("Cloud key auth failed: %d",
                static_cast<int>(cloud_auth_result.status().code()));
    NotifyUnauthorized();
    co_return pw::OkStatus();
  }

  // Get auth_id from the cloud key provider
  if (!cloud_key_provider.auth_id()) {
    PW_LOG_ERROR("Cloud auth succeeded but no auth_id");
    NotifyUnauthorized();
    co_return pw::OkStatus();
  }

  const auto& auth_id = *cloud_key_provider.auth_id();
  auth_cache_.Insert(tag_uid, auth_id,
                     std::string_view(authorized.user_label), now);
  NotifyAuthorized(tag_uid, authorized.user_id,
                   authorized.user_label, auth_id);

  co_return pw::OkStatus();
}

}  // namespace maco::app_state
