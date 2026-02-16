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
#include "pw_sync/lock_annotations.h"

namespace maco::secrets {
class DeviceSecrets;
}  // namespace maco::secrets

namespace maco::firebase {
class FirebaseClient;
}  // namespace maco::firebase

namespace maco::personalize {

/// Orchestrates NFC tag identification, key provisioning, and SDM
/// configuration. Replaces the monolithic TagProber class.
class PersonalizeCoordinator {
 public:
  PersonalizeCoordinator(nfc::NfcReader& reader,
                         secrets::DeviceSecrets& device_secrets,
                         firebase::FirebaseClient& firebase_client,
                         pw::random::RandomGenerator& rng,
                         pw::allocator::Allocator& allocator);

  void Start(pw::async2::Dispatcher& dispatcher);

  /// Arm personalization for the next factory tag tap.
  void RequestPersonalization() PW_LOCKS_EXCLUDED(lock_);

  /// Get a snapshot of the current state (thread-safe).
  void GetSnapshot(PersonalizeSnapshot& snapshot) PW_LOCKS_EXCLUDED(lock_);

 private:
  pw::async2::Coro<pw::Status> Run(pw::async2::CoroContext& cx);

  pw::async2::Coro<pw::Status> HandleTag(pw::async2::CoroContext& cx,
                                          nfc::NfcTag& tag);

  /// Attempt armed personalization: provision keys + configure SDM.
  /// Returns the verified UID on success for state reporting.
  pw::async2::Coro<pw::Status> TryPersonalize(
      pw::async2::CoroContext& cx,
      nfc::NfcTag& tag,
      const maco::TagUid& tag_uid);

  void SetState(PersonalizeStateId state) PW_LOCKS_EXCLUDED(lock_);
  void SetStateWithUid(PersonalizeStateId state,
                       const std::array<std::byte, 7>& uid,
                       size_t uid_size) PW_LOCKS_EXCLUDED(lock_);
  void SetError(std::string_view message) PW_LOCKS_EXCLUDED(lock_);

  bool IsArmed() PW_LOCKS_EXCLUDED(lock_);
  void Disarm() PW_LOCKS_EXCLUDED(lock_);

  nfc::NfcReader& reader_;
  secrets::DeviceSecrets& device_secrets_;
  firebase::FirebaseClient& firebase_client_;
  pw::random::RandomGenerator& rng_;

  pw::async2::CoroContext coro_cx_;
  std::optional<pw::async2::CoroOrElseTask> task_;

  pw::sync::InterruptSpinLock lock_;
  PersonalizeSnapshot snapshot_ PW_GUARDED_BY(lock_);
  bool personalize_armed_ PW_GUARDED_BY(lock_) = false;
};

}  // namespace maco::personalize
