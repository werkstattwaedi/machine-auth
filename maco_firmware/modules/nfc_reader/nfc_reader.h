// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <memory>
#include <optional>

#include "pw_async2/dispatcher.h"
#include "pw_async2/value_future.h"
#include "pw_bytes/span.h"
#include "pw_chrono/system_clock.h"
#include "pw_result/result.h"
#include "pw_status/status.h"

namespace maco::nfc {

// Forward declarations
class NfcTag;
struct NfcEvent;

/// Type alias for transceive operation result future.
/// Resolves to the response length (data written to provided buffer) or error.
using TransceiveFuture = pw::async2::ValueFuture<pw::Result<size_t>>;

/// Type alias for event notification future.
using EventFuture = pw::async2::ValueFuture<NfcEvent>;

/// Type alias for initialization result future.
using InitFuture = pw::async2::ValueFuture<pw::Status>;

/// Abstract NFC reader interface.
///
/// Provides a platform-agnostic API for NFC tag detection and communication.
/// Implementations:
/// - Pn532NfcReader: Real hardware using PN532 over UART
/// - MockNfcReader: Simulation for host and unit tests
///
/// The reader runs as an async task, detecting tags and notifying the
/// application via events. Tag operations (transceive) are also async.
class NfcReader {
 public:
  virtual ~NfcReader() = default;

  // -- Lifecycle --

  /// Start the reader task and begin async initialization.
  ///
  /// Returns a future that resolves when initialization completes. The reader
  /// will automatically begin detecting tags once initialized successfully.
  ///
  /// @param dispatcher The async dispatcher to register the reader task with
  /// @return Future that resolves with OkStatus on success, or an error status
  virtual InitFuture Start(pw::async2::Dispatcher& dispatcher) = 0;

  // -- Tag Access --

  /// Check if a tag is currently present.
  virtual bool HasTag() const = 0;

  /// Get the current tag, if present.
  /// @return Shared pointer to tag, or nullptr if no tag
  virtual std::shared_ptr<NfcTag> GetCurrentTag() = 0;

  /// Get the current tag as a specific type.
  /// @tparam T Tag type to cast to (e.g., Iso14443Tag, Ntag424Tag)
  /// @return Shared pointer to tag, or nullptr if no tag or wrong type
  template <typename T>
  std::shared_ptr<T> GetTagAs() {
    return std::dynamic_pointer_cast<T>(GetCurrentTag());
  }

  // -- Operations --

  /// Request a transceive operation (send command, receive response).
  ///
  /// The operation is queued and executed asynchronously. The response
  /// data is written to response_buffer, and the returned future
  /// resolves to the response length or an error.
  ///
  /// @param command Command bytes to send to the tag
  /// @param response_buffer Buffer for response data
  /// @param timeout Maximum time to wait for response
  /// @return Future that resolves to response length or error
  virtual TransceiveFuture RequestTransceive(
      pw::ConstByteSpan command,
      pw::ByteSpan response_buffer,
      pw::chrono::SystemClock::duration timeout) = 0;

  // -- Event Subscription --

  /// Subscribe to tag events (arrival/departure).
  ///
  /// Returns a future that resolves when the next event occurs.
  /// Call again after receiving an event to get subsequent events.
  ///
  /// @return Future that resolves to the next NfcEvent
  virtual EventFuture SubscribeOnce() = 0;
};

}  // namespace maco::nfc
