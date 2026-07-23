// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <array>
#include <cstddef>

#include "maco_firmware/apps/personalize/personalization_keys.h"
#include "maco_firmware/modules/nfc_tag/ntag424/ntag424_tag.h"
#include "pw_async2/coro.h"
#include "pw_bytes/span.h"
#include "pw_random/random.h"
#include "pw_result/result.h"
#include "pw_string/string_builder.h"

namespace maco::personalize {

/// Outcome of verifying an already-personalized (MaCo) tag against the
/// expected keys and SDM configuration.
struct VerificationReport {
  static constexpr size_t kNumKeys = 5;

  /// Anticollision UID is a 4-byte random ID (first byte 0x08).
  bool random_uid_enabled = false;

  /// Per key slot: AuthenticateEV2First with the expected key succeeded.
  /// Mutual authentication is the only way to check a key — success proves
  /// the slot holds exactly the expected key.
  std::array<bool, kNumKeys> key_ok{};

  /// GetCardUid returned the expected real 7-byte UID.
  bool uid_matches = false;

  /// NDEF file content matches the template (outside the SDM mirrors).
  bool ndef_matches = false;

  /// GetFileSettings shows SDM enabled with the expected options/offsets.
  bool sdm_settings_ok = false;

  /// False when key 0 did not authenticate, so the checks that need an
  /// authenticated session (UID, NDEF, file settings) could not run.
  bool read_checks_ran = false;

  bool AllOk() const;

  /// Append a compact comma-separated list of the failed checks.
  void FormatFailures(pw::StringBuilder& out) const;
};

/// Verify a personalized tag against the keys delivered over RPC.
///
/// Authenticates every key slot with its expected key (slots 1-4 first,
/// slot 0 last so its session is reused for the session-bound checks:
/// GetCardUid and GetFileSettings), then verifies the real UID, the SDM
/// file settings, and the NDEF template. The NDEF file's read access is
/// free, so its read-back is served via the SDM path like a phone tap:
/// mirror regions are excluded from the compare and each verification
/// consumes SDMReadCtr values (one per read chunk).
///
/// Key mismatches and configuration deviations are recorded in the
/// report; only transport-level failures (tag left the field) return an
/// error status.
pw::async2::Coro<pw::Result<VerificationReport>> VerifyPersonalization(
    pw::async2::CoroContext cx,
    nfc::Ntag424Tag& ntag,
    pw::ConstByteSpan anticollision_uid,
    pw::ConstByteSpan expected_uid,
    const PersonalizationKeys& keys,
    pw::random::RandomGenerator& rng);

}  // namespace maco::personalize
