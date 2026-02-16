// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <optional>

#include "maco_firmware/apps/personalize/screens/personalize_screen.h"
#include "maco_firmware/modules/nfc_reader/nfc_reader.h"
#include "maco_firmware/modules/nfc_tag/nfc_tag.h"
#include "maco_firmware/modules/nfc_tag/ntag424/ntag424_tag.h"
#include "maco_firmware/types.h"
#include "pw_allocator/allocator.h"
#include "pw_async2/coro.h"
#include "pw_async2/coro_or_else_task.h"
#include "pw_async2/dispatcher.h"
#include "pw_random/random.h"
#include "pw_sync/interrupt_spin_lock.h"

namespace maco::secrets {
class DeviceSecrets;
}  // namespace maco::secrets

namespace maco::firebase {
class FirebaseClient;
}  // namespace maco::firebase

namespace maco::personalize {

/// Probes NFC tags to classify them (factory/MaCo/unknown) and
/// optionally personalizes factory tags with cloud-derived keys.
class TagProber {
 public:
  TagProber(nfc::NfcReader& reader,
            secrets::DeviceSecrets& device_secrets,
            firebase::FirebaseClient& firebase_client,
            pw::random::RandomGenerator& rng,
            pw::allocator::Allocator& allocator);

  void Start(pw::async2::Dispatcher& dispatcher);

  /// Arm personalization for the next factory tag tap.
  /// Called from the RPC service (possibly different thread).
  void RequestPersonalization();

  /// Get a snapshot of the current state (thread-safe).
  void GetSnapshot(PersonalizeSnapshot& snapshot);

 private:
  pw::async2::Coro<pw::Status> Run(pw::async2::CoroContext& cx);
  pw::async2::Coro<pw::Status> ProbeTag(pw::async2::CoroContext& cx,
                                         nfc::NfcTag& tag);
  pw::async2::Coro<pw::Status> PersonalizeTag(pw::async2::CoroContext& cx,
                                               nfc::Ntag424Tag& ntag,
                                               const maco::TagUid& tag_uid);

  void SetState(PersonalizeStateId state);
  void SetStateWithUid(PersonalizeStateId state,
                       const std::array<std::byte, 7>& uid,
                       size_t uid_size);
  void SetError(std::string_view message);

  nfc::NfcReader& reader_;
  secrets::DeviceSecrets& device_secrets_;
  firebase::FirebaseClient& firebase_client_;
  pw::random::RandomGenerator& rng_;

  pw::async2::CoroContext coro_cx_;
  std::optional<pw::async2::CoroOrElseTask> task_;

  // Shared state protected by lock
  pw::sync::InterruptSpinLock lock_;
  PersonalizeSnapshot snapshot_;
  bool personalize_armed_ = false;
};

}  // namespace maco::personalize
