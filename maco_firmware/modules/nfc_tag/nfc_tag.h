// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <atomic>
#include <cstddef>
#include <cstdint>

#include "pw_bytes/span.h"

namespace maco::nfc {

/// Base interface for all NFC tags.
///
/// Tags are owned by the NfcReader via shared_ptr. Applications can hold
/// shared_ptr to tags safely - when a tag is removed from the field, it is
/// marked as invalid rather than destroyed immediately.
class NfcTag {
 public:
  virtual ~NfcTag() = default;

  /// Get the tag's UID.
  virtual pw::ConstByteSpan uid() const = 0;

  /// Check if this tag supports ISO 14443-4 (APDUs).
  virtual bool supports_iso14443_4() const = 0;

  /// Check if this tag is still valid (present in the field).
  /// Returns false after the tag has been removed.
  bool is_valid() const { return valid_.load(std::memory_order_acquire); }

  /// Mark this tag as invalid. Called by NfcReader when tag is removed.
  void Invalidate() {
    valid_.store(false, std::memory_order_release);
    OnInvalidated();
  }

 protected:
  /// Called when tag is invalidated. Override to clean up derived class state.
  virtual void OnInvalidated() {}

 private:
  std::atomic<bool> valid_{true};
};

}  // namespace maco::nfc
