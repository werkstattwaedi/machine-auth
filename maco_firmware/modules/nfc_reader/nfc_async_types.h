// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

/// @file nfc_async_types.h
/// @brief Async future types for NFC operations.
///
/// Provides ValueFuture type aliases for NFC reader operations.
/// These are used by async NFC driver implementations.

#include "maco_firmware/modules/nfc_reader/nfc_reader_driver.h"
#include "pw_async2/value_future.h"
#include "pw_result/result.h"

namespace maco::nfc {

/// Future type for tag detection operations.
/// Returns TagInfo on success, or an error status.
using DetectTagFuture = pw::async2::ValueFuture<pw::Result<TagInfo>>;

/// Future type for APDU transceive operations.
/// Returns the number of response bytes on success.
using TransceiveFuture = pw::async2::ValueFuture<pw::Result<size_t>>;

/// Future type for tag presence check operations.
/// Returns true if tag is present, false if removed.
using CheckPresentFuture = pw::async2::ValueFuture<pw::Result<bool>>;

}  // namespace maco::nfc
