// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#define PW_LOG_MODULE_NAME "KEYS"

#include "maco_firmware/apps/personalize/key_updater.h"

#include "firebase/types.h"
#include "maco_firmware/modules/nfc_tag/ntag424/local_key_provider.h"
#include "pw_log/log.h"

namespace maco::personalize {

namespace {
constexpr std::array<std::byte, 16> kDefaultKey = {};
constexpr uint8_t kApplicationKeyNumber = 0;
constexpr uint8_t kTerminalKeyNumber = 1;
constexpr uint8_t kAuthorizationKeyNumber = 2;
constexpr uint8_t kSdmMacKeyNumber = 3;
constexpr uint8_t kReserved2KeyNumber = 4;
}  // namespace

pw::async2::Coro<pw::Result<nfc::Ntag424Session>> UpdateKeys(
    pw::async2::CoroContext& cx,
    nfc::Ntag424Tag& ntag,
    const firebase::KeyDiversificationResult& keys,
    pw::ConstByteSpan terminal_key,
    pw::random::RandomGenerator& rng) {
  PW_LOG_INFO("Starting key provisioning...");

  // Step 1: Handle key 0 idempotently — try default key first
  auto select_status = co_await ntag.SelectApplication(cx);
  if (!select_status.ok()) {
    co_return select_status;
  }

  {
    nfc::LocalKeyProvider default_key_provider(kApplicationKeyNumber,
                                               kDefaultKey, rng);
    auto auth_result = co_await ntag.Authenticate(cx, default_key_provider);
    if (auth_result.ok()) {
      PW_LOG_INFO("Changing key 0 (application)...");
      auto change_status = co_await ntag.ChangeKey(
          cx, *auth_result, kApplicationKeyNumber,
          keys.application_key, 0x01);
      if (!change_status.ok()) {
        PW_LOG_ERROR("ChangeKey 0 failed: %d",
                     static_cast<int>(change_status.code()));
        co_return change_status;
      }
    } else {
      PW_LOG_INFO("Default key 0 failed, key may already be changed");
    }
  }

  // Re-select + authenticate with application_key
  auto reselect_status = co_await ntag.SelectApplication(cx);
  if (!reselect_status.ok()) {
    co_return reselect_status;
  }

  nfc::LocalKeyProvider app_key_provider(kApplicationKeyNumber,
                                         keys.application_key, rng);
  auto session_result = co_await ntag.Authenticate(cx, app_key_provider);
  if (!session_result.ok()) {
    PW_LOG_ERROR("Auth with application key failed");
    co_return session_result.status();
  }

  // Step 2: Change keys 1-4 idempotently
  struct KeyChange {
    uint8_t number;
    const char* name;
    pw::ConstByteSpan new_key;
  };

  const KeyChange key_changes[] = {
      {kTerminalKeyNumber, "terminal", terminal_key},
      {kAuthorizationKeyNumber, "authorization", keys.authorization_key},
      {kSdmMacKeyNumber, "sdm_mac", keys.sdm_mac_key},
      {kReserved2KeyNumber, "reserved2", keys.reserved2_key},
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
    // Re-auth and retry with old_key = target_key (no-op when already set).
    PW_LOG_INFO("Key %u default failed, retrying with target key...",
                static_cast<unsigned>(kc.number));

    auto resel = co_await ntag.SelectApplication(cx);
    if (!resel.ok()) {
      co_return resel;
    }

    nfc::LocalKeyProvider retry_provider(kApplicationKeyNumber,
                                         keys.application_key, rng);
    session_result = co_await ntag.Authenticate(cx, retry_provider);
    if (!session_result.ok()) {
      PW_LOG_ERROR("Re-auth failed during key %u retry",
                   static_cast<unsigned>(kc.number));
      co_return session_result.status();
    }

    change_status = co_await ntag.ChangeKey(
        cx, *session_result, kc.number, kc.new_key, 0x01, kc.new_key);
    if (!change_status.ok()) {
      PW_LOG_ERROR("ChangeKey %u failed on retry: %d",
                   static_cast<unsigned>(kc.number),
                   static_cast<int>(change_status.code()));
      co_return change_status;
    }
  }

  PW_LOG_INFO("Key provisioning complete");

  // Return session for subsequent operations (SDM configuration)
  co_return *session_result;
}

}  // namespace maco::personalize
