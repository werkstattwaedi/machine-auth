// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <string_view>

#include "maco_firmware/modules/nfc_tag/ntag424/ntag424_session.h"
#include "maco_firmware/modules/nfc_tag/ntag424/ntag424_tag.h"
#include "pw_async2/coro.h"
#include "pw_status/status.h"

namespace maco::personalize {

/// Write NDEF URL template and enable SDM on an NTAG424 tag.
///
/// Builds the NDEF template dynamically from the given base URL.
/// Idempotent: checks current file settings first and skips if SDM
/// is already configured with the correct offsets.
///
/// Requires an authenticated session with key 0 (application key).
///
/// @param base_url URL part after "https://", e.g. "id.werkstattwaedi.ch/"
/// @param session Proof token from Authenticate() with key 0
pw::async2::Coro<pw::Status> ConfigureSdm(
    pw::async2::CoroContext& cx,
    nfc::Ntag424Tag& ntag,
    const nfc::Ntag424Session& session,
    std::string_view base_url);

}  // namespace maco::personalize
