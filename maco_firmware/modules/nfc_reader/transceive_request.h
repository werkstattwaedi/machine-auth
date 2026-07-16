// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <cstdint>

#include "pw_bytes/span.h"
#include "pw_chrono/system_clock.h"

namespace maco::nfc {

/// Represents a pending transceive request from the application.
///
/// This structure holds the command/response buffers and timeout for an
/// operation requested via NfcReader::RequestTransceive(). The reader
/// stores this internally while the operation is in progress.
struct TransceiveRequest {
  pw::ConstByteSpan command;
  pw::ByteSpan response_buffer;
  pw::chrono::SystemClock::duration timeout;

  /// Tag generation this request was captured against. The reader bumps a
  /// counter on every tag arrival; a request whose generation no longer
  /// matches the current tag must be rejected rather than replayed, so a
  /// stale APDU can never be sent to a different tag.
  uint32_t generation = 0;
};

}  // namespace maco::nfc
