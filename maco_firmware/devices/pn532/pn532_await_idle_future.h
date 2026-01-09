// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include "pw_async2/context.h"
#include "pw_async2/poll.h"

namespace maco::nfc {

class Pn532NfcReader;  // Forward declaration

/// Future that completes when no operation is in progress.
///
/// Use this to wait before starting a new operation if another might be
/// in progress. Returns Ready immediately if already idle.
class Pn532AwaitIdleFuture {
 public:
  explicit Pn532AwaitIdleFuture(Pn532NfcReader& reader) : reader_(&reader) {}

  // Movable
  Pn532AwaitIdleFuture(Pn532AwaitIdleFuture&& other) noexcept
      : reader_(other.reader_) {
    other.reader_ = nullptr;
  }
  Pn532AwaitIdleFuture& operator=(Pn532AwaitIdleFuture&& other) noexcept {
    reader_ = other.reader_;
    other.reader_ = nullptr;
    return *this;
  }

  // Not copyable
  Pn532AwaitIdleFuture(const Pn532AwaitIdleFuture&) = delete;
  Pn532AwaitIdleFuture& operator=(const Pn532AwaitIdleFuture&) = delete;

  /// Poll the future. Returns Ready when reader is idle.
  pw::async2::Poll<> Pend(pw::async2::Context& cx);

 private:
  Pn532NfcReader* reader_;
};

}  // namespace maco::nfc
