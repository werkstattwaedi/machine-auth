// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#define PW_LOG_MODULE_NAME "COORD"

#include "maco_firmware/apps/personalize/personalize_coordinator.h"

#include "device_secrets/device_secrets.h"
#include "firebase/firebase_client.h"
#include "maco_firmware/apps/personalize/key_updater.h"
#include "maco_firmware/apps/personalize/sdm_configurator.h"
#include "maco_firmware/apps/personalize/tag_identifier.h"
#include "maco_firmware/modules/nfc_reader/nfc_event.h"
#include "maco_firmware/modules/nfc_tag/ntag424/ntag424_tag.h"
#include "pw_log/log.h"

namespace maco::personalize {

PersonalizeCoordinator::PersonalizeCoordinator(
    nfc::NfcReader& reader,
    secrets::DeviceSecrets& device_secrets,
    firebase::FirebaseClient& firebase_client,
    pw::random::RandomGenerator& rng,
    pw::allocator::Allocator& allocator)
    : reader_(reader),
      device_secrets_(device_secrets),
      firebase_client_(firebase_client),
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

void PersonalizeCoordinator::RequestPersonalization() {
  std::lock_guard guard(lock_);
  personalize_armed_ = true;
  snapshot_.state = PersonalizeStateId::kAwaitingTag;
  snapshot_.error_message.clear();
  PW_LOG_INFO("Personalization armed - waiting for next factory tag");
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

bool PersonalizeCoordinator::IsArmed() {
  std::lock_guard guard(lock_);
  return personalize_armed_;
}

void PersonalizeCoordinator::Disarm() {
  std::lock_guard guard(lock_);
  personalize_armed_ = false;
}

pw::async2::Coro<pw::Status> PersonalizeCoordinator::Run(
    pw::async2::CoroContext& cx) {
  while (true) {
    {
      std::lock_guard guard(lock_);
      if (personalize_armed_ &&
          snapshot_.state != PersonalizeStateId::kAwaitingTag) {
        snapshot_.state = PersonalizeStateId::kAwaitingTag;
      }
    }

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
        if (IsArmed()) {
          SetState(PersonalizeStateId::kAwaitingTag);
        } else {
          SetState(PersonalizeStateId::kIdle);
        }
        break;
    }
  }
  co_return pw::OkStatus();
}

pw::async2::Coro<pw::Status> PersonalizeCoordinator::HandleTag(
    pw::async2::CoroContext& cx,
    nfc::NfcTag& tag) {
  auto id_result =
      co_await IdentifyTag(cx, tag, reader_, device_secrets_, rng_);
  if (!id_result.ok()) {
    SetState(PersonalizeStateId::kUnknownTag);
    co_return id_result.status();
  }

  const auto& id = *id_result;

  switch (id.type) {
    case TagType::kFactory:
    case TagType::kMaCo: {
      if (IsArmed()) {
        if (id.uid_size == maco::TagUid::kSize) {
          auto tag_uid = maco::TagUid::FromArray(id.uid);
          co_await TryPersonalize(cx, tag, tag_uid);
        } else {
          SetError("Invalid UID size for personalization");
        }
      } else {
        auto state = id.type == TagType::kFactory
                         ? PersonalizeStateId::kFactoryTag
                         : PersonalizeStateId::kMacoTag;
        SetStateWithUid(state, id.uid, id.uid_size);
      }
      break;
    }

    case TagType::kUnknown: {
      if (IsArmed()) {
        // Unknown tag while armed: may be partially personalized (key 0
        // changed but authentication with terminal key failed). Use
        // anti-collision UID for key diversification; after UpdateKeys
        // succeeds, GetCardUid provides the authenticated UID.
        auto ac_uid = tag.uid();
        if (ac_uid.size() == maco::TagUid::kSize) {
          std::array<std::byte, 7> uid_buffer{};
          std::copy(ac_uid.begin(), ac_uid.end(), uid_buffer.begin());
          auto tag_uid = maco::TagUid::FromArray(uid_buffer);
          PW_LOG_INFO(
              "Armed: unknown tag, attempting with anti-collision UID");
          co_await TryPersonalize(cx, tag, tag_uid);
        } else {
          SetState(PersonalizeStateId::kUnknownTag);
        }
      } else {
        SetState(PersonalizeStateId::kUnknownTag);
      }
      break;
    }
  }

  co_return pw::OkStatus();
}

pw::async2::Coro<pw::Status> PersonalizeCoordinator::TryPersonalize(
    pw::async2::CoroContext& cx,
    nfc::NfcTag& tag,
    const maco::TagUid& tag_uid) {
  SetState(PersonalizeStateId::kPersonalizing);
  PW_LOG_INFO("Starting tag personalization...");

  auto tag_info = TagInfoFromNfcTag(tag);
  nfc::Ntag424Tag ntag(reader_, tag_info);

  // Get diversified keys from Firebase
  auto keys_result =
      co_await firebase_client_.KeyDiversification(cx, tag_uid);
  if (!keys_result.ok()) {
    PW_LOG_ERROR("KeyDiversification failed: %d",
                 static_cast<int>(keys_result.status().code()));
    SetError("Key diversification failed");
    co_return keys_result.status();
  }

  // Get terminal key from device secrets
  auto terminal_key_result = device_secrets_.GetNtagTerminalKey();
  if (!terminal_key_result.ok()) {
    PW_LOG_ERROR("Terminal key not provisioned");
    SetError("Terminal key not provisioned");
    co_return terminal_key_result.status();
  }

  // Provision keys (idempotent)
  auto session_result = co_await UpdateKeys(
      cx, ntag, *keys_result, terminal_key_result->bytes(), rng_);
  if (!session_result.ok()) {
    SetError("Key provisioning failed");
    co_return session_result.status();
  }

  // SEC-4: Get authenticated UID via GetCardUid (prefer over anti-collision)
  std::array<std::byte, 7> verified_uid{};
  size_t verified_uid_size = 0;
  auto uid_result = co_await ntag.GetCardUid(
      cx, *session_result, pw::ByteSpan(verified_uid));
  if (uid_result.ok()) {
    verified_uid_size = *uid_result;
  } else {
    // Fall back to input UID if GetCardUid fails
    PW_LOG_WARN("GetCardUid failed after key provisioning, using input UID");
    auto uid_bytes = tag_uid.bytes();
    std::copy(uid_bytes.begin(), uid_bytes.end(), verified_uid.begin());
    verified_uid_size = uid_bytes.size();
  }

  // Configure SDM (idempotent)
  auto sdm_status = co_await ConfigureSdm(cx, ntag, *session_result);
  if (!sdm_status.ok()) {
    SetError("SDM configuration failed");
    co_return sdm_status;
  }

  // Enable random UID for privacy (tag returns random UID during anticollision)
  PW_LOG_INFO("Enabling random UID...");
  auto rid_status = co_await ntag.EnableRandomUid(cx, *session_result);
  if (!rid_status.ok()) {
    PW_LOG_WARN("EnableRandomUid failed: %d (non-fatal)",
                static_cast<int>(rid_status.code()));
    // Non-fatal: tag works without random UID, just less private
  }

  PW_LOG_INFO("Tag personalization complete!");
  SetStateWithUid(
      PersonalizeStateId::kPersonalized, verified_uid, verified_uid_size);
  Disarm();
  co_return pw::OkStatus();
}

}  // namespace maco::personalize
