// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <optional>

#include "maco_firmware/apps/personalize/personalization_keys.h"
#include "maco_firmware/apps/personalize/screens/personalize_screen.h"
#include "maco_firmware/modules/nfc_reader/nfc_reader.h"
#include "maco_firmware/modules/nfc_tag/nfc_tag.h"
#include "maco_firmware/modules/nfc_tag/ntag424/ntag424_tag.h"
#include "maco_firmware/types.h"
#include "maco_pb/personalization_service.pb.h"
#include "pw_allocator/allocator.h"
#include "pw_async2/coro.h"
#include "pw_async2/coro_or_else_task.h"
#include "pw_async2/dispatcher.h"
#include "pw_async2/value_future.h"
#include "pw_random/random.h"
#include "pw_rpc/nanopb/server_reader_writer.h"
#include "pw_sync/interrupt_spin_lock.h"
#include "pw_sync/lock_annotations.h"

namespace maco::personalize {

/// Orchestrates NFC tag identification, key provisioning, and SDM
/// configuration. Keys are delivered from the console over RPC.
class PersonalizeCoordinator {
 public:
  PersonalizeCoordinator(nfc::NfcReader& reader,
                         pw::random::RandomGenerator& rng,
                         pw::allocator::Allocator& allocator);

  void Start(pw::async2::Dispatcher& dispatcher);

  /// Store the server-streaming writer for pushing tag events to the console.
  void SetTagEventWriter(
      pw::rpc::NanopbServerWriter<maco_TagEvent>&& writer)
      PW_LOCKS_EXCLUDED(lock_);

  /// Deliver pre-diversified keys from the RPC thread. Wakes the coroutine.
  void DeliverKeys(const PersonalizationKeys& keys)
      PW_LOCKS_EXCLUDED(lock_);

  /// Get a snapshot of the current state (thread-safe).
  void GetSnapshot(PersonalizeSnapshot& snapshot) PW_LOCKS_EXCLUDED(lock_);

 private:
  pw::async2::Coro<pw::Status> Run(pw::async2::CoroContext& cx);

  pw::async2::Coro<pw::Status> HandleTag(pw::async2::CoroContext& cx,
                                          nfc::NfcTag& tag);

  /// Attempt personalization: provision keys + configure SDM.
  pw::async2::Coro<pw::Status> TryPersonalize(
      pw::async2::CoroContext& cx,
      nfc::NfcTag& tag,
      const maco::TagUid& tag_uid,
      const PersonalizationKeys& keys);

  void SetState(PersonalizeStateId state) PW_LOCKS_EXCLUDED(lock_);
  void SetStateWithUid(PersonalizeStateId state,
                       const std::array<std::byte, 7>& uid,
                       size_t uid_size) PW_LOCKS_EXCLUDED(lock_);
  void SetError(std::string_view message) PW_LOCKS_EXCLUDED(lock_);

  /// Send a TagEvent to the console via the server stream.
  void StreamTagEvent(maco_TagEvent_EventType event_type,
                      maco_TagEvent_TagType tag_type,
                      pw::ConstByteSpan uid,
                      std::string_view message) PW_LOCKS_EXCLUDED(lock_);

  nfc::NfcReader& reader_;
  pw::random::RandomGenerator& rng_;

  pw::async2::CoroContext coro_cx_;
  std::optional<pw::async2::CoroOrElseTask> task_;

  pw::sync::InterruptSpinLock lock_;
  PersonalizeSnapshot snapshot_ PW_GUARDED_BY(lock_);
  pw::rpc::NanopbServerWriter<maco_TagEvent> tag_event_writer_
      PW_GUARDED_BY(lock_);
  pw::async2::ValueProvider<PersonalizationKeys> keys_provider_;
};

}  // namespace maco::personalize
