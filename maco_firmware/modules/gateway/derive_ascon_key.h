// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

/// @file derive_ascon_key.h
/// @brief Shared ASCON key derivation from master secret and device ID.

#include <array>
#include <cstddef>

#include "maco_firmware/types.h"
#include "pw_bytes/span.h"

namespace maco::gateway {

/// Derive per-device ASCON key from master secret and device ID.
/// key = ASCON-Hash256(master_secret || device_id)[0:16]
std::array<std::byte, 16> DeriveAsconKey(pw::ConstByteSpan master_secret,
                                         const DeviceId& device_id);

}  // namespace maco::gateway
