// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

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
};

}  // namespace maco::nfc
