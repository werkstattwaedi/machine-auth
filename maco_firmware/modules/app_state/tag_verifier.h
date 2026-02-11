// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <optional>

#include "maco_firmware/modules/app_state/app_state.h"
#include "maco_firmware/modules/nfc_reader/nfc_reader.h"
#include "maco_firmware/modules/nfc_tag/nfc_tag.h"
#include "pw_allocator/allocator.h"
#include "pw_async2/coro.h"
#include "pw_async2/coro_or_else_task.h"
#include "pw_async2/dispatcher.h"
#include "pw_random/random.h"

namespace maco::secrets {
class DeviceSecrets;
}  // namespace maco::secrets

namespace maco::app_state {

/// Subscribes to NFC events and verifies tags via NTAG424 authentication.
///
/// For each arriving tag:
/// 1. Checks ISO 14443-4 support
/// 2. Selects the NTAG424 application
/// 3. Authenticates with the terminal key (key slot 2)
/// 4. Reads the real card UID (anti-collision UID is random on NTAG424)
///
/// Updates AppState at each step so the UI can reflect progress.
class TagVerifier {
 public:
  TagVerifier(nfc::NfcReader& reader,
              AppState& app_state,
              secrets::DeviceSecrets& device_secrets,
              pw::random::RandomGenerator& rng,
              pw::allocator::Allocator& allocator);

  void Start(pw::async2::Dispatcher& dispatcher);

 private:
  pw::async2::Coro<pw::Status> Run(pw::async2::CoroContext& cx);
  pw::async2::Coro<pw::Status> VerifyTag(pw::async2::CoroContext& cx,
                                          nfc::NfcTag& tag);

  nfc::NfcReader& reader_;
  AppState& app_state_;
  secrets::DeviceSecrets& device_secrets_;
  pw::random::RandomGenerator& rng_;

  pw::async2::CoroContext coro_cx_;
  std::optional<pw::async2::CoroOrElseTask> task_;
};

}  // namespace maco::app_state
