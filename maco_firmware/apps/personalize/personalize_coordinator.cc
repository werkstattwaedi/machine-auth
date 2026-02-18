// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#define PW_LOG_MODULE_NAME "COORD"

#include "maco_firmware/apps/personalize/personalize_coordinator.h"

#include "maco_firmware/apps/personalize/key_updater.h"
#include "maco_firmware/apps/personalize/sdm_configurator.h"
#include "maco_firmware/apps/personalize/tag_identifier.h"  // TagInfoFromNfcTag
#include "maco_firmware/modules/nfc_reader/nfc_event.h"
#include "maco_firmware/modules/nfc_tag/ntag424/local_key_provider.h"
#include "maco_firmware/modules/nfc_tag/ntag424/ntag424_tag.h"
#include "pw_log/log.h"

namespace maco::personalize {

PersonalizeCoordinator::PersonalizeCoordinator(
    nfc::NfcReader& reader,
    pw::random::RandomGenerator& rng,
    pw::allocator::Allocator& allocator)
    : reader_(reader),
      rng_(rng),
      coro_cx_(allocator) {}

void PersonalizeCoordinator::Start(pw::async2::Dispatcher& dispatcher) {
  auto coro = Run(coro_cx_);
  task_.emplace(std::move(coro), [](pw::Status s) {
    PW_LOG_ERROR("PersonalizeCoordinator failed: %d",
                 static_cast<int>(s.code()));
  });
  dispatcher.Post(*task_);
}

void PersonalizeCoordinator::SetTagEventWriter(
    pw::rpc::NanopbServerWriter<maco_TagEvent>&& writer) {
  std::lock_guard guard(lock_);
  tag_event_writer_ = std::move(writer);
  PW_LOG_INFO("Tag event stream connected");
}

void PersonalizeCoordinator::DeliverKeys(const PersonalizationKeys& keys) {
  keys_provider_.Resolve(keys);
}

void PersonalizeCoordinator::GetSnapshot(PersonalizeSnapshot& snapshot) {
  std::lock_guard guard(lock_);
  snapshot = snapshot_;
}

void PersonalizeCoordinator::SetState(PersonalizeStateId state) {
  std::lock_guard guard(lock_);
  snapshot_.state = state;
}

void PersonalizeCoordinator::SetStateWithUid(
    PersonalizeStateId state,
    const std::array<std::byte, 7>& uid,
    size_t uid_size) {
  std::lock_guard guard(lock_);
  snapshot_.state = state;
  snapshot_.uid = uid;
  snapshot_.uid_size = uid_size;
}

void PersonalizeCoordinator::SetError(std::string_view message) {
  std::lock_guard guard(lock_);
  snapshot_.state = PersonalizeStateId::kError;
  snapshot_.error_message.assign(message.data(), message.size());
}

void PersonalizeCoordinator::StreamTagEvent(
    maco_TagEvent_EventType event_type,
    maco_TagEvent_TagType tag_type,
    pw::ConstByteSpan uid,
    std::string_view message) {
  std::lock_guard guard(lock_);
  if (!tag_event_writer_.active()) {
    return;
  }

  maco_TagEvent event = maco_TagEvent_init_zero;
  event.event_type = event_type;
  event.tag_type = tag_type;

  size_t uid_len = std::min(uid.size(), sizeof(event.uid.bytes));
  std::memcpy(event.uid.bytes, uid.data(), uid_len);
  event.uid.size = uid_len;

  size_t msg_len =
      std::min(message.size(), sizeof(event.message) - 1);
  std::memcpy(event.message, message.data(), msg_len);
  event.message[msg_len] = '\0';

  auto status = tag_event_writer_.Write(event);
  if (!status.ok()) {
    PW_LOG_WARN("Failed to stream tag event: %d",
                static_cast<int>(status.code()));
  }
}

pw::async2::Coro<pw::Status> PersonalizeCoordinator::Run(
    pw::async2::CoroContext& cx) {
  while (true) {
    SetState(PersonalizeStateId::kIdle);

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
        SetState(PersonalizeStateId::kProbing);

        auto status = co_await HandleTag(cx, *event.tag);
        if (!status.ok()) {
          PW_LOG_WARN("Tag handling failed: %d",
                      static_cast<int>(status.code()));
        }
        break;
      }

      case nfc::NfcEventType::kTagDeparted:
        PW_LOG_INFO("Tag departed");
        StreamTagEvent(maco_TagEvent_EventType_TAG_DEPARTED,
                       maco_TagEvent_TagType_TAG_UNKNOWN,
                       {}, "");
        SetState(PersonalizeStateId::kIdle);
        break;
    }
  }
  co_return pw::OkStatus();
}

pw::async2::Coro<pw::Status> PersonalizeCoordinator::HandleTag(
    pw::async2::CoroContext& cx,
    nfc::NfcTag& tag) {
  // IdentifyTag still needs device_secrets for the terminal key probe.
  // With the new architecture, the tag identifier uses the reader's
  // factory-default key probe only (no terminal key check needed for
  // classification — factory tags have default keys, MaCo tags don't).
  // However, the existing IdentifyTag requires DeviceSecrets. Since we
  // no longer have it, we do a simplified identification: try default key 0.
  // If auth succeeds → factory tag. If fails → already personalized (MaCo)
  // or unknown.

  auto tag_info = TagInfoFromNfcTag(tag);
  nfc::Ntag424Tag ntag(reader_, tag_info);

  // Try to select the NTAG424 application
  auto select_status = co_await ntag.SelectApplication(cx);
  if (!select_status.ok()) {
    SetState(PersonalizeStateId::kUnknownTag);
    StreamTagEvent(maco_TagEvent_EventType_TAG_ARRIVED,
                   maco_TagEvent_TagType_TAG_UNKNOWN,
                   tag.uid(), "Not an NTAG424 tag");
    co_return pw::OkStatus();
  }

  // Try authenticating with default key 0
  constexpr std::array<std::byte, 16> kDefaultKey = {};
  nfc::LocalKeyProvider default_provider(0, kDefaultKey, rng_);
  auto auth_result = co_await ntag.Authenticate(cx, default_provider);

  TagType tag_type;
  std::array<std::byte, 7> uid_buffer{};
  size_t uid_size = 0;

  if (auth_result.ok()) {
    // Default key works → factory tag
    tag_type = TagType::kFactory;

    // Get authenticated UID
    auto uid_result = co_await ntag.GetCardUid(
        cx, *auth_result, pw::ByteSpan(uid_buffer));
    if (uid_result.ok()) {
      uid_size = *uid_result;
    } else {
      // Fall back to anti-collision UID
      auto ac_uid = tag.uid();
      uid_size = std::min(ac_uid.size(), uid_buffer.size());
      std::copy_n(ac_uid.begin(), uid_size, uid_buffer.begin());
    }
  } else {
    // Default key failed → assume already personalized (MaCo tag)
    tag_type = TagType::kMaCo;
    auto ac_uid = tag.uid();
    uid_size = std::min(ac_uid.size(), uid_buffer.size());
    std::copy_n(ac_uid.begin(), uid_size, uid_buffer.begin());
  }

  auto stream_tag_type = tag_type == TagType::kFactory
                             ? maco_TagEvent_TagType_TAG_FACTORY
                             : maco_TagEvent_TagType_TAG_MACO;
  auto screen_state = tag_type == TagType::kFactory
                          ? PersonalizeStateId::kFactoryTag
                          : PersonalizeStateId::kMacoTag;

  SetStateWithUid(screen_state, uid_buffer, uid_size);
  StreamTagEvent(maco_TagEvent_EventType_TAG_ARRIVED,
                 stream_tag_type,
                 pw::ConstByteSpan(uid_buffer.data(), uid_size), "");

  // Wait for keys from the console
  SetState(PersonalizeStateId::kAwaitingTag);
  PW_LOG_INFO("Waiting for keys from console...");

  auto keys_future = keys_provider_.Get();
  PersonalizationKeys keys = co_await keys_future;

  PW_LOG_INFO("Keys received from console, personalizing...");

  if (uid_size == maco::TagUid::kSize) {
    auto tag_uid = maco::TagUid::FromArray(uid_buffer);
    co_await TryPersonalize(cx, tag, tag_uid, keys);
  } else {
    SetError("Invalid UID size for personalization");
    StreamTagEvent(maco_TagEvent_EventType_PERSONALIZATION_FAILED,
                   stream_tag_type,
                   pw::ConstByteSpan(uid_buffer.data(), uid_size),
                   "Invalid UID size");
  }

  co_return pw::OkStatus();
}

pw::async2::Coro<pw::Status> PersonalizeCoordinator::TryPersonalize(
    pw::async2::CoroContext& cx,
    nfc::NfcTag& tag,
    const maco::TagUid& tag_uid,
    const PersonalizationKeys& keys) {
  SetState(PersonalizeStateId::kPersonalizing);
  PW_LOG_INFO("Starting tag personalization...");

  auto tag_info = TagInfoFromNfcTag(tag);
  nfc::Ntag424Tag ntag(reader_, tag_info);

  // Provision keys (idempotent)
  auto session_result = co_await UpdateKeys(cx, ntag, keys, rng_);
  if (!session_result.ok()) {
    SetError("Key provisioning failed");
    StreamTagEvent(maco_TagEvent_EventType_PERSONALIZATION_FAILED,
                   maco_TagEvent_TagType_TAG_FACTORY,
                   tag_uid.bytes(), "Key provisioning failed");
    co_return session_result.status();
  }

  // Get authenticated UID via GetCardUid
  std::array<std::byte, 7> verified_uid{};
  size_t verified_uid_size = 0;
  auto uid_result = co_await ntag.GetCardUid(
      cx, *session_result, pw::ByteSpan(verified_uid));
  if (uid_result.ok()) {
    verified_uid_size = *uid_result;
  } else {
    PW_LOG_WARN("GetCardUid failed after key provisioning, using input UID");
    auto uid_bytes = tag_uid.bytes();
    std::copy(uid_bytes.begin(), uid_bytes.end(), verified_uid.begin());
    verified_uid_size = uid_bytes.size();
  }

  // Configure SDM (idempotent)
  auto sdm_status = co_await ConfigureSdm(cx, ntag, *session_result);
  if (!sdm_status.ok()) {
    SetError("SDM configuration failed");
    StreamTagEvent(maco_TagEvent_EventType_PERSONALIZATION_FAILED,
                   maco_TagEvent_TagType_TAG_FACTORY,
                   pw::ConstByteSpan(verified_uid.data(), verified_uid_size),
                   "SDM configuration failed");
    co_return sdm_status;
  }

  // Enable random UID for privacy
  PW_LOG_INFO("Enabling random UID...");
  auto rid_status = co_await ntag.EnableRandomUid(cx, *session_result);
  if (!rid_status.ok()) {
    PW_LOG_WARN("EnableRandomUid failed: %d (non-fatal)",
                static_cast<int>(rid_status.code()));
  }

  PW_LOG_INFO("Tag personalization complete!");
  SetStateWithUid(
      PersonalizeStateId::kPersonalized, verified_uid, verified_uid_size);
  StreamTagEvent(maco_TagEvent_EventType_PERSONALIZATION_COMPLETE,
                 maco_TagEvent_TagType_TAG_MACO,
                 pw::ConstByteSpan(verified_uid.data(), verified_uid_size),
                 "");
  co_return pw::OkStatus();
}

}  // namespace maco::personalize
