// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <optional>

#include "pw_bytes/span.h"
#include "pw_chrono/system_clock.h"
#include "pw_result/result.h"

namespace maco::nfc {

/// Represents a pending transceive request from the application.
///
/// This structure holds the command/response buffers and timeout for an
/// operation requested by the tag. The NfcReader fills in the result
/// when the operation completes.
struct TransceiveRequest {
  pw::ConstByteSpan command;
  pw::ByteSpan response_buffer;
  pw::chrono::SystemClock::duration timeout;

  // Result storage (filled by NfcReader when complete)
  std::optional<pw::Result<size_t>> result;
  bool completed = false;

  /// Mark the request as completed with a result.
  void Complete(pw::Result<size_t> res) {
    result = std::move(res);
    completed = true;
  }
};

/// Future returned to the application when requesting a transceive operation.
///
/// Polls until NfcReader completes the request. Used by tags to execute
/// operations through the reader's FSM.
class TransceiveRequestFuture {
 public:
  explicit TransceiveRequestFuture(TransceiveRequest* request)
      : request_(request) {}

  /// Check if the request has been completed.
  bool IsReady() const { return request_->completed; }

  /// Take the result (moves out of the request).
  /// Only valid to call when IsReady() returns true.
  pw::Result<size_t> Take() { return std::move(*request_->result); }

 private:
  TransceiveRequest* request_;
};

}  // namespace maco::nfc
