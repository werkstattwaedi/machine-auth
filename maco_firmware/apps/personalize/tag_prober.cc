// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#define PW_LOG_MODULE_NAME "PROBE"

#include "maco_firmware/apps/personalize/tag_prober.h"

#include "device_secrets/device_secrets.h"
#include "firebase/firebase_client.h"
#include "maco_firmware/devices/pn532/tag_info.h"
#include "maco_firmware/modules/nfc_reader/nfc_event.h"
#include "maco_firmware/modules/nfc_tag/ntag424/local_key_provider.h"
#include "maco_firmware/modules/nfc_tag/ntag424/ntag424_tag.h"
#include "pw_log/log.h"

namespace maco::personalize {

namespace {
// Default factory key (all zeros)
constexpr std::array<std::byte, 16> kDefaultKey = {};
constexpr uint8_t kApplicationKeyNumber = 0;
constexpr uint8_t kTerminalKeyNumber = 1;
constexpr uint8_t kAuthorizationKeyNumber = 2;
constexpr uint8_t kReserved1KeyNumber = 3;
constexpr uint8_t kReserved2KeyNumber = 4;
}  // namespace

TagProber::TagProber(nfc::NfcReader& reader,
                     secrets::DeviceSecrets& device_secrets,
                     firebase::FirebaseClient& firebase_client,
                     pw::random::RandomGenerator& rng,
                     pw::allocator::Allocator& allocator)
    : reader_(reader),
      device_secrets_(device_secrets),
      firebase_client_(firebase_client),
      rng_(rng),
      coro_cx_(allocator) {}

void TagProber::Start(pw::async2::Dispatcher& dispatcher) {
  auto coro = Run(coro_cx_);
  task_.emplace(std::move(coro), [](pw::Status s) {
    PW_LOG_ERROR("TagProber failed: %d", static_cast<int>(s.code()));
  });
  dispatcher.Post(*task_);
}

void TagProber::RequestPersonalization() {
  std::lock_guard guard(lock_);
  personalize_armed_ = true;
  snapshot_.state = PersonalizeStateId::kAwaitingTag;
  snapshot_.error_message.clear();
  PW_LOG_INFO("Personalization armed - waiting for next factory tag");
}

void TagProber::GetSnapshot(PersonalizeSnapshot& snapshot) {
  std::lock_guard guard(lock_);
  snapshot = snapshot_;
}

void TagProber::SetState(PersonalizeStateId state) {
  std::lock_guard guard(lock_);
  snapshot_.state = state;
}

void TagProber::SetStateWithUid(PersonalizeStateId state,
                                const std::array<std::byte, 7>& uid,
                                size_t uid_size) {
  std::lock_guard guard(lock_);
  snapshot_.state = state;
  snapshot_.uid = uid;
  snapshot_.uid_size = uid_size;
}

void TagProber::SetError(std::string_view message) {
  std::lock_guard guard(lock_);
  snapshot_.state = PersonalizeStateId::kError;
  snapshot_.error_message.assign(message.data(), message.size());
}

pw::async2::Coro<pw::Status> TagProber::Run(pw::async2::CoroContext& cx) {
  while (true) {
    // Check if we're armed (but no tag yet)
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

        auto status = co_await ProbeTag(cx, *event.tag);
        if (!status.ok()) {
          PW_LOG_WARN("Tag probe failed: %d",
                      static_cast<int>(status.code()));
        }
        break;
      }

      case nfc::NfcEventType::kTagDeparted:
        PW_LOG_INFO("Tag departed");
        // Return to idle or awaiting depending on armed state
        {
          std::lock_guard guard(lock_);
          if (personalize_armed_) {
            snapshot_.state = PersonalizeStateId::kAwaitingTag;
          } else {
            snapshot_.state = PersonalizeStateId::kIdle;
          }
        }
        break;
    }
  }
  co_return pw::OkStatus();
}

pw::async2::Coro<pw::Status> TagProber::ProbeTag(
    pw::async2::CoroContext& cx,
    nfc::NfcTag& tag) {
  // Step 1: Check ISO 14443-4 support
  if (!tag.supports_iso14443_4()) {
    PW_LOG_INFO("Tag does not support ISO 14443-4");
    SetState(PersonalizeStateId::kUnknownTag);
    co_return pw::OkStatus();
  }

  // Reconstruct TagInfo for Ntag424Tag
  nfc::TagInfo tag_info{};
  auto uid = tag.uid();
  tag_info.uid_length = uid.size();
  std::copy(uid.begin(), uid.end(), tag_info.uid.begin());
  tag_info.sak = tag.sak();
  tag_info.target_number = tag.target_number();
  tag_info.supports_iso14443_4 = true;

  nfc::Ntag424Tag ntag(reader_, tag_info);

  // Step 2: Select NTAG424 application
  auto select_status = co_await ntag.SelectApplication(cx);
  if (!select_status.ok()) {
    PW_LOG_INFO("SelectApplication failed: %d",
                static_cast<int>(select_status.code()));
    SetState(PersonalizeStateId::kUnknownTag);
    co_return pw::OkStatus();
  }

  // Step 3: Probe default key (key 0, all zeros)
  {
    nfc::LocalKeyProvider key_provider(kApplicationKeyNumber, kDefaultKey, rng_);
    auto auth_result = co_await ntag.Authenticate(cx, key_provider);
    if (auth_result.ok()) {
      // Factory tag! Read UID.
      std::array<std::byte, 7> uid_buffer{};
      auto uid_result = co_await ntag.GetCardUid(
          cx, *auth_result, pw::ByteSpan(uid_buffer));

      size_t real_uid_size = 0;
      if (uid_result.ok()) {
        real_uid_size = *uid_result;
      } else {
        PW_LOG_WARN("GetCardUid failed on factory tag");
      }

      PW_LOG_INFO("Factory tag detected");

      // Check if armed for personalization
      bool armed = false;
      {
        std::lock_guard guard(lock_);
        armed = personalize_armed_;
      }

      if (armed) {
        // Build TagUid from the real UID
        if (real_uid_size == maco::TagUid::kSize) {
          auto tag_uid = maco::TagUid::FromArray(uid_buffer);
          SetState(PersonalizeStateId::kPersonalizing);
          auto status = co_await PersonalizeTag(cx, ntag, tag_uid);
          if (status.ok()) {
            SetStateWithUid(PersonalizeStateId::kPersonalized,
                            uid_buffer, real_uid_size);
            {
              std::lock_guard guard(lock_);
              personalize_armed_ = false;
            }
          }
          // Error state is set inside PersonalizeTag on failure
        } else {
          SetError("Invalid UID size for personalization");
        }
      } else {
        SetStateWithUid(PersonalizeStateId::kFactoryTag,
                        uid_buffer, real_uid_size);
      }
      co_return pw::OkStatus();
    }
  }

  // Step 4: When armed and factory key failed, the tag may be partially
  // personalized (key 0 changed but remaining keys still default).
  // Attempt personalization using the anti-collision UID, which equals the
  // real UID for NTAG424 DNA.
  {
    bool armed = false;
    {
      std::lock_guard guard(lock_);
      armed = personalize_armed_;
    }

    if (armed) {
      auto ac_uid = tag.uid();
      if (ac_uid.size() == maco::TagUid::kSize) {
        std::array<std::byte, 7> uid_buffer{};
        std::copy(ac_uid.begin(), ac_uid.end(), uid_buffer.begin());
        auto tag_uid = maco::TagUid::FromArray(uid_buffer);

        PW_LOG_INFO("Armed: factory key failed, attempting personalization "
                    "with anti-collision UID");
        SetState(PersonalizeStateId::kPersonalizing);
        auto status = co_await PersonalizeTag(cx, ntag, tag_uid);
        if (status.ok()) {
          SetStateWithUid(PersonalizeStateId::kPersonalized,
                          uid_buffer, ac_uid.size());
          {
            std::lock_guard guard(lock_);
            personalize_armed_ = false;
          }
        }
        co_return pw::OkStatus();
      }
    }
  }

  // Step 5: Probe terminal key (key 1)
  // Re-select application (auth clears session)
  auto reselect_status = co_await ntag.SelectApplication(cx);
  if (!reselect_status.ok()) {
    SetState(PersonalizeStateId::kUnknownTag);
    co_return pw::OkStatus();
  }

  auto terminal_key_result = device_secrets_.GetNtagTerminalKey();
  if (terminal_key_result.ok()) {
    nfc::LocalKeyProvider key_provider(
        kTerminalKeyNumber, terminal_key_result->bytes(), rng_);
    auto auth_result = co_await ntag.Authenticate(cx, key_provider);
    if (auth_result.ok()) {
      // MaCo tag! Read UID.
      std::array<std::byte, 7> uid_buffer{};
      auto uid_result = co_await ntag.GetCardUid(
          cx, *auth_result, pw::ByteSpan(uid_buffer));

      size_t real_uid_size = 0;
      if (uid_result.ok()) {
        real_uid_size = *uid_result;
      }

      PW_LOG_INFO("MaCo tag detected");
      SetStateWithUid(PersonalizeStateId::kMacoTag,
                      uid_buffer, real_uid_size);
      co_return pw::OkStatus();
    }
  }

  // Neither key worked
  PW_LOG_INFO("Unknown tag (neither default nor terminal key worked)");
  SetState(PersonalizeStateId::kUnknownTag);
  co_return pw::OkStatus();
}

pw::async2::Coro<pw::Status> TagProber::PersonalizeTag(
    pw::async2::CoroContext& cx,
    nfc::Ntag424Tag& ntag,
    const maco::TagUid& tag_uid) {
  PW_LOG_INFO("Starting tag personalization...");

  // Step 1: Get diversified keys from Firebase
  auto keys_result =
      co_await firebase_client_.KeyDiversification(cx, tag_uid);
  if (!keys_result.ok()) {
    PW_LOG_ERROR("KeyDiversification failed: %d",
                 static_cast<int>(keys_result.status().code()));
    SetError("Key diversification failed");
    co_return keys_result.status();
  }

  // Step 2: Get terminal key from device secrets
  auto terminal_key_result = device_secrets_.GetNtagTerminalKey();
  if (!terminal_key_result.ok()) {
    PW_LOG_ERROR("Terminal key not provisioned");
    SetError("Terminal key not provisioned");
    co_return terminal_key_result.status();
  }

  // Step 3: Establish auth session (handle key 0 idempotently)
  //   Try default key first. If it fails, key 0 was already changed —
  //   try application_key instead.
  auto select_status = co_await ntag.SelectApplication(cx);
  if (!select_status.ok()) {
    SetError("SelectApplication failed");
    co_return select_status;
  }

  {
    nfc::LocalKeyProvider default_key_provider(kApplicationKeyNumber,
                                               kDefaultKey, rng_);
    auto auth_result = co_await ntag.Authenticate(cx, default_key_provider);
    if (auth_result.ok()) {
      // Factory key still works — change key 0 to application_key
      PW_LOG_INFO("Changing key 0 (application)...");
      auto change_status = co_await ntag.ChangeKey(
          cx, *auth_result, kApplicationKeyNumber,
          keys_result->application_key, 0x01);
      if (!change_status.ok()) {
        PW_LOG_ERROR("ChangeKey 0 failed: %d",
                     static_cast<int>(change_status.code()));
        SetError("ChangeKey 0 failed");
        co_return change_status;
      }
    } else {
      PW_LOG_INFO("Default key 0 failed, key may already be changed");
    }
  }

  // Re-select + authenticate with application_key (works for both fresh
  // and partially-personalized tags after the block above)
  auto reselect_status = co_await ntag.SelectApplication(cx);
  if (!reselect_status.ok()) {
    SetError("Re-select after key 0 failed");
    co_return reselect_status;
  }

  nfc::LocalKeyProvider app_key_provider(kApplicationKeyNumber,
                                         keys_result->application_key, rng_);
  auto session_result = co_await ntag.Authenticate(cx, app_key_provider);
  if (!session_result.ok()) {
    PW_LOG_ERROR("Auth with application key failed — unknown tag state");
    SetError("Auth with application key failed");
    co_return session_result.status();
  }

  // Step 4: Change keys 1-4 idempotently
  //   Try with old_key=default first. If that fails, the key was already
  //   changed — re-auth and try with old_key=target_key (no-op ChangeKey).
  struct KeyChange {
    uint8_t number;
    const char* name;
    pw::ConstByteSpan new_key;
  };

  const KeyChange key_changes[] = {
      {kTerminalKeyNumber, "terminal", terminal_key_result->bytes()},
      {kAuthorizationKeyNumber, "authorization", keys_result->authorization_key},
      {kReserved1KeyNumber, "reserved1", keys_result->reserved1_key},
      {kReserved2KeyNumber, "reserved2", keys_result->reserved2_key},
  };

  for (const auto& kc : key_changes) {
    PW_LOG_INFO("Changing key %u (%s)...",
                static_cast<unsigned>(kc.number), kc.name);

    auto change_status = co_await ntag.ChangeKey(
        cx, *session_result, kc.number, kc.new_key, 0x01, kDefaultKey);
    if (change_status.ok()) {
      continue;
    }

    // ChangeKey with default old_key failed — key may already be changed.
    // Re-auth (ChangeKey failure invalidates session) and retry with
    // old_key = target_key. When stored key == target_key this is a no-op.
    PW_LOG_INFO("Key %u default failed, retrying with target key...",
                static_cast<unsigned>(kc.number));

    auto resel = co_await ntag.SelectApplication(cx);
    if (!resel.ok()) {
      SetError("Re-select failed during key retry");
      co_return resel;
    }

    nfc::LocalKeyProvider retry_provider(kApplicationKeyNumber,
                                         keys_result->application_key, rng_);
    session_result = co_await ntag.Authenticate(cx, retry_provider);
    if (!session_result.ok()) {
      PW_LOG_ERROR("Re-auth failed during key %u retry",
                   static_cast<unsigned>(kc.number));
      SetError("Re-auth failed during key retry");
      co_return session_result.status();
    }

    change_status = co_await ntag.ChangeKey(
        cx, *session_result, kc.number, kc.new_key, 0x01, kc.new_key);
    if (!change_status.ok()) {
      PW_LOG_ERROR("ChangeKey %u failed on retry: %d",
                   static_cast<unsigned>(kc.number),
                   static_cast<int>(change_status.code()));
      SetError("ChangeKey failed on retry");
      co_return change_status;
    }
  }

  PW_LOG_INFO("Tag personalization complete!");
  co_return pw::OkStatus();
}

}  // namespace maco::personalize
