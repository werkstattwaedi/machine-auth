// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#define PW_LOG_MODULE_NAME "VRFY"

#include "maco_firmware/modules/app_state/tag_verifier.h"

#include "device_secrets/device_secrets.h"
#include "maco_firmware/devices/pn532/tag_info.h"
#include "maco_firmware/modules/nfc_reader/nfc_event.h"
#include "maco_firmware/modules/nfc_tag/ntag424/local_key_provider.h"
#include "maco_firmware/modules/nfc_tag/ntag424/ntag424_tag.h"
#include "pw_log/log.h"

namespace maco::app_state {

// Terminal key slot on NTAG424 (matches DeviceSecrets::GetNtagTerminalKey)
constexpr uint8_t kTerminalKeyNumber = 2;

TagVerifier::TagVerifier(nfc::NfcReader& reader,
                         AppState& app_state,
                         secrets::DeviceSecrets& device_secrets,
                         pw::random::RandomGenerator& rng,
                         pw::allocator::Allocator& allocator)
    : reader_(reader),
      app_state_(app_state),
      device_secrets_(device_secrets),
      rng_(rng),
      coro_cx_(allocator) {}

void TagVerifier::Start(pw::async2::Dispatcher& dispatcher) {
  auto coro = Run(coro_cx_);
  task_.emplace(std::move(coro), [](pw::Status s) {
    PW_LOG_ERROR("TagVerifier failed: %d", static_cast<int>(s.code()));
  });
  dispatcher.Post(*task_);
}

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
        app_state_.OnTagDetected(event.tag->uid());

        auto status = co_await VerifyTag(cx, *event.tag);
        if (!status.ok()) {
          PW_LOG_WARN("Tag verification failed: %d",
                      static_cast<int>(status.code()));
        }
        break;
      }

      case nfc::NfcEventType::kTagDeparted:
        PW_LOG_INFO("Tag departed");
        app_state_.OnTagRemoved();
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
    app_state_.OnUnknownTag();
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
    app_state_.OnUnknownTag();
    co_return pw::OkStatus();
  }

  // Step 4: Authenticate with terminal key
  app_state_.OnVerifying();

  auto key_result = device_secrets_.GetNtagTerminalKey();
  if (!key_result.ok()) {
    PW_LOG_ERROR("Terminal key not provisioned");
    app_state_.OnUnknownTag();
    co_return pw::OkStatus();
  }

  nfc::LocalKeyProvider key_provider(
      kTerminalKeyNumber, key_result->bytes(), rng_);

  auto auth_result = co_await ntag.Authenticate(cx, key_provider);
  if (!auth_result.ok()) {
    PW_LOG_INFO("Authentication failed: %d",
                static_cast<int>(auth_result.status().code()));
    app_state_.OnUnknownTag();
    co_return pw::OkStatus();
  }

  // Step 5: Read real card UID
  std::array<std::byte, 7> uid_buffer{};
  auto uid_result = co_await ntag.GetCardUid(
      cx, *auth_result, pw::ByteSpan(uid_buffer));
  if (!uid_result.ok()) {
    PW_LOG_INFO("GetCardUid failed: %d",
                static_cast<int>(uid_result.status().code()));
    app_state_.OnUnknownTag();
    co_return pw::OkStatus();
  }

  pw::ConstByteSpan real_uid(uid_buffer.data(), *uid_result);
  PW_LOG_INFO("Tag verified, real UID: %u bytes",
              static_cast<unsigned>(*uid_result));
  app_state_.OnTagVerified(real_uid);

  co_return pw::OkStatus();
}

}  // namespace maco::app_state
