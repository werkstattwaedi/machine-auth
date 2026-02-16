// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include "maco_firmware/modules/nfc_tag/ntag424/ntag424_session.h"
#include "maco_firmware/modules/nfc_tag/ntag424/ntag424_tag.h"
#include "pw_async2/coro.h"
#include "pw_status/status.h"

namespace maco::personalize {

/// Write NDEF URL template and enable SDM on an NTAG424 tag.
///
/// Idempotent: checks current file settings first and skips if SDM
/// is already configured with the correct offsets.
///
/// Requires an authenticated session with key 0 (application key).
///
/// @param session Proof token from Authenticate() with key 0
pw::async2::Coro<pw::Status> ConfigureSdm(
    pw::async2::CoroContext& cx,
    nfc::Ntag424Tag& ntag,
    const nfc::Ntag424Session& session);

}  // namespace maco::personalize
