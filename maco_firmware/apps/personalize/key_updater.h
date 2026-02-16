// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <array>
#include <cstddef>

#include "maco_firmware/modules/nfc_tag/ntag424/ntag424_session.h"
#include "maco_firmware/modules/nfc_tag/ntag424/ntag424_tag.h"
#include "pw_async2/coro.h"
#include "pw_bytes/span.h"
#include "pw_random/random.h"
#include "pw_result/result.h"

namespace maco::firebase {
struct KeyDiversificationResult;
}

namespace maco::personalize {

/// Idempotently provision all 5 keys on an NTAG424 tag.
///
/// Handles key 0 first (tries default, then application key), then
/// keys 1-4 with retry logic for partially-personalized tags.
///
/// @param keys Pre-fetched diversified keys from Firebase
/// @param terminal_key 16-byte terminal key from device secrets
/// @return Session from final authentication (for subsequent SDM config)
pw::async2::Coro<pw::Result<nfc::Ntag424Session>> UpdateKeys(
    pw::async2::CoroContext& cx,
    nfc::Ntag424Tag& ntag,
    const firebase::KeyDiversificationResult& keys,
    pw::ConstByteSpan terminal_key,
    pw::random::RandomGenerator& rng);

}  // namespace maco::personalize
