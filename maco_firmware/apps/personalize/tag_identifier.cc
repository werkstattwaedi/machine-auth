// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#define PW_LOG_MODULE_NAME "IDENT"

#include "maco_firmware/apps/personalize/tag_identifier.h"

#include "device_secrets/device_secrets.h"
#include "maco_firmware/modules/nfc_reader/nfc_reader.h"
#include "maco_firmware/modules/nfc_tag/ntag424/local_key_provider.h"
#include "maco_firmware/modules/nfc_tag/ntag424/ntag424_tag.h"
#include "pw_log/log.h"

namespace maco::personalize {

namespace {
constexpr std::array<std::byte, 16> kDefaultKey = {};
constexpr uint8_t kApplicationKeyNumber = 0;
constexpr uint8_t kTerminalKeyNumber = 1;
}  // namespace

pw::async2::Coro<pw::Result<TagIdentification>> IdentifyTag(
    pw::async2::CoroContext& cx,
    nfc::NfcTag& tag,
    nfc::NfcReader& reader,
    secrets::DeviceSecrets& device_secrets,
    pw::random::RandomGenerator& rng) {
  TagIdentification result;

  // Not an NTAG424 candidate
  if (!tag.supports_iso14443_4()) {
    PW_LOG_INFO("Tag does not support ISO 14443-4");
    result.type = TagType::kUnknown;
    co_return result;
  }

  auto tag_info = TagInfoFromNfcTag(tag);
  nfc::Ntag424Tag ntag(reader, tag_info);

  // Select NTAG424 application
  auto select_status = co_await ntag.SelectApplication(cx);
  if (!select_status.ok()) {
    PW_LOG_INFO("SelectApplication failed: %d",
                static_cast<int>(select_status.code()));
    result.type = TagType::kUnknown;
    co_return result;
  }

  // Try default key (factory tag)
  {
    nfc::LocalKeyProvider key_provider(kApplicationKeyNumber, kDefaultKey, rng);
    auto auth_result = co_await ntag.Authenticate(cx, key_provider);
    if (auth_result.ok()) {
      std::array<std::byte, 7> uid_buffer{};
      auto uid_result =
          co_await ntag.GetCardUid(cx, *auth_result, pw::ByteSpan(uid_buffer));

      result.type = TagType::kFactory;
      if (uid_result.ok()) {
        result.uid = uid_buffer;
        result.uid_size = *uid_result;
      }
      PW_LOG_INFO("Factory tag detected");
      co_return result;
    }
  }

  // Try terminal key (MaCo tag) — re-select after failed auth
  auto reselect_status = co_await ntag.SelectApplication(cx);
  if (!reselect_status.ok()) {
    result.type = TagType::kUnknown;
    co_return result;
  }

  auto terminal_key_result = device_secrets.GetNtagTerminalKey();
  if (terminal_key_result.ok()) {
    nfc::LocalKeyProvider key_provider(
        kTerminalKeyNumber, terminal_key_result->bytes(), rng);
    auto auth_result = co_await ntag.Authenticate(cx, key_provider);
    if (auth_result.ok()) {
      std::array<std::byte, 7> uid_buffer{};
      auto uid_result =
          co_await ntag.GetCardUid(cx, *auth_result, pw::ByteSpan(uid_buffer));

      result.type = TagType::kMaCo;
      if (uid_result.ok()) {
        result.uid = uid_buffer;
        result.uid_size = *uid_result;
      }
      PW_LOG_INFO("MaCo tag detected");
      co_return result;
    }
  }

  PW_LOG_INFO("Unknown tag (neither default nor terminal key worked)");
  result.type = TagType::kUnknown;
  co_return result;
}

}  // namespace maco::personalize
