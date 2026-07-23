// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#define PW_LOG_MODULE_NAME "COORD"

#include "maco_firmware/apps/personalize/personalize_coordinator.h"

#include "maco_firmware/apps/personalize/key_updater.h"
#include "maco_firmware/apps/personalize/personalization_verifier.h"
#include "maco_firmware/apps/personalize/sdm_configurator.h"
#include "maco_firmware/apps/personalize/tag_identifier.h"  // TagInfoFromNfcTag
#include "maco_firmware/modules/nfc_reader/nfc_event.h"
#include "maco_firmware/modules/nfc_tag/ntag424/local_key_provider.h"
#include "maco_firmware/modules/nfc_tag/ntag424/ntag424_tag.h"
#include "pw_async2/future.h"
#include "pw_log/log.h"

namespace maco::personalize {

namespace {

/// Races console key delivery against the next NFC event so that a tag
/// leaving the field aborts the wait — otherwise the coordinator would sit
/// in "awaiting keys" forever and ignore every subsequent tap.
///
/// Modeled on async_util::ValueOrTimeout (see its header for why pw_async2's
/// own combinator headers are avoided). The losing future is dropped
/// unresolved, which is safe for ValueFuture: its destructor unlists itself
/// from the provider, and a later Resolve with no waiter is a no-op.
class [[nodiscard]] KeysOrNfcEvent {
 public:
  struct Outcome {
    std::optional<PersonalizationKeys> keys;
    std::optional<nfc::NfcEvent> event;
  };
  using value_type = Outcome;

  constexpr KeysOrNfcEvent() = default;

  KeysOrNfcEvent(pw::async2::ValueFuture<PersonalizationKeys>&& keys,
                 nfc::EventFuture&& event)
      : keys_(std::move(keys)),
        event_(std::move(event)),
        state_(pw::async2::FutureState::kPending) {}

  [[nodiscard]] constexpr bool is_pendable() const {
    return state_.is_pendable();
  }
  [[nodiscard]] constexpr bool is_complete() const {
    return state_.is_complete();
  }

  pw::async2::Poll<Outcome> Pend(pw::async2::Context& cx) {
    auto keys = keys_.Pend(cx);
    if (keys.IsReady()) {
      state_.MarkComplete();
      return pw::async2::Ready(
          Outcome{.keys = std::move(*keys), .event = std::nullopt});
    }
    auto event = event_.Pend(cx);
    if (event.IsReady()) {
      state_.MarkComplete();
      return pw::async2::Ready(
          Outcome{.keys = std::nullopt, .event = std::move(*event)});
    }
    return pw::async2::Pending();
  }

 private:
  pw::async2::ValueFuture<PersonalizationKeys> keys_;
  nfc::EventFuture event_;
  pw::async2::FutureState state_;
};

}  // namespace

PersonalizeCoordinator::PersonalizeCoordinator(
    nfc::NfcReader& reader,
    secrets::DeviceSecrets& device_secrets,
    pw::random::RandomGenerator& rng,
    pw::allocator::Allocator& allocator)
    : reader_(reader),
      device_secrets_(device_secrets),
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
  if (state == PersonalizeStateId::kIdle) {
    // No tag in the field — drop the stale identification.
    snapshot_.tag_kind = DetectedTagKind::kNone;
    snapshot_.uid_size = 0;
  }
}

void PersonalizeCoordinator::SetStateWithUid(
    PersonalizeStateId state,
    DetectedTagKind tag_kind,
    const std::array<std::byte, 7>& uid,
    size_t uid_size) {
  std::lock_guard guard(lock_);
  snapshot_.state = state;
  snapshot_.tag_kind = tag_kind;
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
    pw::async2::CoroContext cx) {
  while (true) {
    SetState(PersonalizeStateId::kIdle);

    nfc::NfcEvent event;
    if (pending_event_.has_value()) {
      // A tag arrival consumed by the awaiting-keys race in HandleTag.
      event = std::move(*pending_event_);
      pending_event_.reset();
    } else {
      auto event_future = reader_.SubscribeOnce();
      event = co_await event_future;
    }

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
    pw::async2::CoroContext cx,
    nfc::NfcTag& tag) {
  // Identify the tag and read its REAL 7-byte UID via GetCardUid. Factory
  // tags authenticate with the default key 0; already-personalized (MaCo)
  // tags authenticate with the provisioned terminal key (key 1, read from
  // device secrets). This is critical: with Random-ID enabled, the
  // anti-collision UID is a random 4-byte value, NOT the real UID — using it
  // would diversify the per-UID keys against the wrong UID. If neither key
  // authenticates, the tag is unknown and we abort rather than guess.
  auto ident_result =
      co_await IdentifyTag(cx, tag, reader_, device_secrets_, rng_);
  if (!ident_result.ok()) {
    SetError("Tag-Identifikation fehlgeschlagen");
    StreamTagEvent(maco_TagEvent_EventType_PERSONALIZATION_FAILED,
                   maco_TagEvent_TagType_TAG_UNKNOWN, tag.uid(),
                   "Identification error");
    co_return ident_result.status();
  }
  const TagIdentification& ident = *ident_result;

  if (ident.type == TagType::kUnknown) {
    // Neither the default nor the terminal key authenticated.
    SetState(PersonalizeStateId::kUnknownTag);
    StreamTagEvent(maco_TagEvent_EventType_TAG_ARRIVED,
                   maco_TagEvent_TagType_TAG_UNKNOWN, tag.uid(),
                   "Unbekannter Tag (Schlüssel passen nicht)");
    co_return pw::OkStatus();
  }

  if (ident.uid_size != maco::TagUid::kSize) {
    // Authenticated, but GetCardUid did not return the real 7-byte UID.
    // Never proceed with a partial UID — it would mis-diversify the keys.
    SetError("Echte UID konnte nicht gelesen werden");
    StreamTagEvent(maco_TagEvent_EventType_PERSONALIZATION_FAILED,
                   ident.type == TagType::kFactory
                       ? maco_TagEvent_TagType_TAG_FACTORY
                       : maco_TagEvent_TagType_TAG_MACO,
                   tag.uid(), "GetCardUid failed");
    co_return pw::OkStatus();
  }

  const std::array<std::byte, 7>& uid_buffer = ident.uid;
  const size_t uid_size = ident.uid_size;
  auto stream_tag_type = ident.type == TagType::kFactory
                             ? maco_TagEvent_TagType_TAG_FACTORY
                             : maco_TagEvent_TagType_TAG_MACO;
  auto screen_state = ident.type == TagType::kFactory
                          ? PersonalizeStateId::kFactoryTag
                          : PersonalizeStateId::kMacoTag;
  auto tag_kind = ident.type == TagType::kFactory ? DetectedTagKind::kFactory
                                                  : DetectedTagKind::kMaco;

  SetStateWithUid(screen_state, tag_kind, uid_buffer, uid_size);
  StreamTagEvent(maco_TagEvent_EventType_TAG_ARRIVED,
                 stream_tag_type,
                 pw::ConstByteSpan(uid_buffer.data(), uid_size), "");

  // Wait for keys from the console, aborting if the tag leaves the field.
  SetState(PersonalizeStateId::kAwaitingTag);
  PW_LOG_INFO("Waiting for keys from console...");

  KeysOrNfcEvent::Outcome outcome = co_await KeysOrNfcEvent(
      keys_provider_.Get(), reader_.SubscribeOnce());

  if (!outcome.keys.has_value()) {
    if (outcome.event.has_value() &&
        outcome.event->type == nfc::NfcEventType::kTagArrived) {
      // Departure was missed; hand the fresh arrival back to the main loop
      // so the new tap is processed immediately.
      PW_LOG_INFO("New tag arrived while waiting for keys");
      pending_event_ = std::move(*outcome.event);
    } else {
      PW_LOG_INFO("Tag departed while waiting for keys");
      StreamTagEvent(maco_TagEvent_EventType_TAG_DEPARTED,
                     stream_tag_type,
                     pw::ConstByteSpan(uid_buffer.data(), uid_size), "");
    }
    co_return pw::OkStatus();
  }
  const PersonalizationKeys& keys = *outcome.keys;

  PW_LOG_INFO("Keys received from console");

  // uid_size was already validated to be a full 7-byte UID above.
  auto tag_uid = maco::TagUid::FromArray(uid_buffer);
  if (ident.type == TagType::kMaCo) {
    // Already personalized: verify everything is written correctly
    // instead of re-personalizing.
    co_await TryVerify(cx, tag, tag_uid, keys);
  } else {
    co_await TryPersonalize(cx, tag, tag_uid, keys);
  }

  co_return pw::OkStatus();
}

pw::async2::Coro<pw::Status> PersonalizeCoordinator::TryPersonalize(
    pw::async2::CoroContext cx,
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
  auto sdm_status = co_await ConfigureSdm(
      cx, ntag, *session_result, keys.sdm_base_url);
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
  SetStateWithUid(PersonalizeStateId::kPersonalized, DetectedTagKind::kMaco,
                  verified_uid, verified_uid_size);
  StreamTagEvent(maco_TagEvent_EventType_PERSONALIZATION_COMPLETE,
                 maco_TagEvent_TagType_TAG_MACO,
                 pw::ConstByteSpan(verified_uid.data(), verified_uid_size),
                 "");
  co_return pw::OkStatus();
}

pw::async2::Coro<pw::Status> PersonalizeCoordinator::TryVerify(
    pw::async2::CoroContext cx,
    nfc::NfcTag& tag,
    const maco::TagUid& tag_uid,
    const PersonalizationKeys& keys) {
  SetState(PersonalizeStateId::kVerifying);
  PW_LOG_INFO("Starting tag verification...");

  auto tag_info = TagInfoFromNfcTag(tag);
  nfc::Ntag424Tag ntag(reader_, tag_info);

  auto report_result = co_await VerifyPersonalization(
      cx, ntag, tag.uid(), tag_uid.bytes(), keys, rng_);
  if (!report_result.ok()) {
    SetError("Verifikation abgebrochen (Tag entfernt?)");
    StreamTagEvent(maco_TagEvent_EventType_VERIFICATION_FAILED,
                   maco_TagEvent_TagType_TAG_MACO,
                   tag_uid.bytes(), "Verification aborted");
    co_return report_result.status();
  }

  const VerificationReport& report = *report_result;
  if (report.AllOk()) {
    PW_LOG_INFO("Tag verification passed!");
    SetStateWithUid(PersonalizeStateId::kVerified, DetectedTagKind::kMaco,
                    tag_uid.array(), maco::TagUid::kSize);
    StreamTagEvent(maco_TagEvent_EventType_VERIFICATION_COMPLETE,
                   maco_TagEvent_TagType_TAG_MACO,
                   tag_uid.bytes(), "");
    co_return pw::OkStatus();
  }

  pw::StringBuffer<128> failures;
  report.FormatFailures(failures);
  PW_LOG_ERROR("Tag verification FAILED: %s", failures.c_str());
  SetError(failures.view());
  StreamTagEvent(maco_TagEvent_EventType_VERIFICATION_FAILED,
                 maco_TagEvent_TagType_TAG_MACO,
                 tag_uid.bytes(), failures.view());
  co_return pw::OkStatus();
}

}  // namespace maco::personalize
